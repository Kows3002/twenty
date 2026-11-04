import { act, renderHook } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { type ReactNode } from 'react';

import { getDefaultObjectPermissions } from '@/object-metadata/utils/getDefaultObjectPermissions';
import { RecordBoardContext } from '@/object-record/record-board/contexts/RecordBoardContext';
import { useUpdateDroppedRecordOnBoard } from '@/object-record/record-drag/hooks/useUpdateDroppedRecordOnBoard';
import { recordGroupDefinitionFamilyState } from '@/object-record/record-group/states/recordGroupDefinitionFamilyState';
import { recordGroupIdsComponentState } from '@/object-record/record-group/states/recordGroupIdsComponentState';
import { RecordGroupDefinitionType } from '@/object-record/record-group/types/RecordGroupDefinition';
import { recordIndexRecordIdsByGroupComponentFamilyState } from '@/object-record/record-index/states/recordIndexRecordIdsByGroupComponentFamilyState';
import { recordStoreFamilyState } from '@/object-record/record-store/states/recordStoreFamilyState';
import { ViewComponentInstanceContext } from '@/views/states/contexts/ViewComponentInstanceContext';
import { getMockObjectMetadataItemOrThrow } from '~/testing/utils/getMockObjectMetadataItemOrThrow';

const INSTANCE_ID = 'board';
const objectMetadataItem = getMockObjectMetadataItemOrThrow('opportunity');
const selectFieldMetadataItem = objectMetadataItem.fields.find(
  (field) => field.name === 'stage',
)!;
const updateOneRecord = jest.fn();
const recordAtom = recordStoreFamilyState.atomFamily('dragged');
const groupAtom = (groupId: string) =>
  recordIndexRecordIdsByGroupComponentFamilyState.atomFamily({
    instanceId: INSTANCE_ID,
    familyKey: groupId,
  });

const initialRecord = {
  id: 'dragged',
  __typename: 'Opportunity',
  stage: 'NEW',
  position: 2,
  name: 'Original name',
};

const getWrapper =
  (store: ReturnType<typeof createStore>) =>
  ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>
      <ViewComponentInstanceContext.Provider
        value={{ instanceId: INSTANCE_ID }}
      >
        <RecordBoardContext.Provider
          value={{
            objectMetadataItem,
            selectFieldMetadataItem,
            recordBoardId: INSTANCE_ID,
            updateOneRecord,
            createOneRecord: jest.fn(),
            deleteOneRecord: jest.fn(),
            objectPermissions: getDefaultObjectPermissions(
              objectMetadataItem.id,
            ),
          }}
        >
          {children}
        </RecordBoardContext.Provider>
      </ViewComponentInstanceContext.Provider>
    </JotaiProvider>
  );

const setup = () => {
  const store = createStore();
  store.set(recordAtom, initialRecord);
  store.set(groupAtom('source'), ['before', 'dragged', 'after']);
  store.set(groupAtom('target'), ['target-record']);
  store.set(recordStoreFamilyState.atomFamily('before'), {
    id: 'before',
    __typename: 'Opportunity',
    stage: 'NEW',
    position: 1,
  });
  store.set(recordStoreFamilyState.atomFamily('after'), {
    id: 'after',
    __typename: 'Opportunity',
    position: 3,
  });
  store.set(recordStoreFamilyState.atomFamily('target-record'), {
    id: 'target-record',
    __typename: 'Opportunity',
    position: 1,
  });
  store.set(
    recordGroupIdsComponentState.atomFamily({ instanceId: INSTANCE_ID }),
    ['source', 'target'],
  );
  for (const [id, value] of [
    ['source', 'NEW'],
    ['target', 'WON'],
  ]) {
    store.set(recordGroupDefinitionFamilyState.atomFamily(id), {
      id,
      value,
      title: value,
      type: RecordGroupDefinitionType.Value,
      color: 'blue',
      position: 0,
      isVisible: true,
    });
  }
  const { result } = renderHook(() => useUpdateDroppedRecordOnBoard(), {
    wrapper: getWrapper(store),
  });
  return { store, result };
};

describe('useUpdateDroppedRecordOnBoard', () => {
  beforeEach(() => {
    updateOneRecord.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the optimistic move when saving succeeds', async () => {
    updateOneRecord.mockResolvedValue(undefined);
    const { store, result } = setup();

    await act(async () => {
      await result.current.updateDroppedRecordOnBoard(
        { recordId: 'dragged', position: 2 },
        'WON',
      );
    });

    expect(store.get(groupAtom('source'))).toEqual(['before', 'after']);
    expect(store.get(groupAtom('target'))).toEqual([
      'target-record',
      'dragged',
    ]);
    expect(store.get(recordAtom)).toMatchObject({ stage: 'WON', position: 2 });
    expect(updateOneRecord).toHaveBeenCalledWith({
      idToUpdate: 'dragged',
      updateOneRecordInput: { stage: 'WON', position: 2 },
    });
  });

  it.each([0, 20, 700])(
    'restores the source column and record after a rejection delayed by %i ms',
    async (delay) => {
      jest.useFakeTimers();
      const error = new Error('User does not have permission.');
      updateOneRecord.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(error), delay);
          }),
      );
      const { store, result } = setup();
      let update!: Promise<void>;

      act(() => {
        update = result.current.updateDroppedRecordOnBoard(
          { recordId: 'dragged', position: 4 },
          'WON',
        );
      });
      const rejection = expect(update).rejects.toThrow(error);
      expect(store.get(groupAtom('target'))).toContain('dragged');
      expect(store.get(recordAtom)).toMatchObject({
        stage: 'WON',
        position: 4,
      });

      await act(async () => {
        jest.advanceTimersByTime(delay);
        await rejection;
      });

      expect(store.get(groupAtom('source'))).toEqual([
        'before',
        'dragged',
        'after',
      ]);
      expect(store.get(groupAtom('target'))).toEqual(['target-record']);
      expect(store.get(recordAtom)).toEqual(initialRecord);
    },
  );

  it('restores the original order when a reorder within a column fails', async () => {
    updateOneRecord.mockRejectedValue(new Error('Save failed'));
    const { store, result } = setup();

    await act(async () => {
      await expect(
        result.current.updateDroppedRecordOnBoard(
          { recordId: 'dragged', position: 4 },
          'NEW',
        ),
      ).rejects.toThrow('Save failed');
    });

    expect(store.get(groupAtom('source'))).toEqual([
      'before',
      'dragged',
      'after',
    ]);
    expect(store.get(recordAtom)).toEqual(initialRecord);
  });

  it('restores a move on a sorted board without changing the record position', async () => {
    updateOneRecord.mockRejectedValue(new Error('Save failed'));
    const { store, result } = setup();

    await act(async () => {
      await expect(
        result.current.updateDroppedRecordOnBoard(
          { recordId: 'dragged' },
          'WON',
        ),
      ).rejects.toThrow('Save failed');
    });

    expect(updateOneRecord).toHaveBeenCalledWith({
      idToUpdate: 'dragged',
      updateOneRecordInput: { stage: 'WON' },
    });
    expect(store.get(groupAtom('source'))).toEqual([
      'before',
      'dragged',
      'after',
    ]);
    expect(store.get(groupAtom('target'))).toEqual(['target-record']);
    expect(store.get(recordAtom)).toEqual(initialRecord);
  });

  it('does not undo a successful move when the next selected card fails', async () => {
    updateOneRecord
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Save failed'));
    const { store, result } = setup();

    await act(async () => {
      await result.current.updateDroppedRecordOnBoard(
        { recordId: 'dragged', position: 2 },
        'WON',
      );
      await expect(
        result.current.updateDroppedRecordOnBoard(
          { recordId: 'before', position: 3 },
          'WON',
        ),
      ).rejects.toThrow('Save failed');
    });

    expect(store.get(groupAtom('source'))).toEqual(['before', 'after']);
    expect(store.get(groupAtom('target'))).toEqual([
      'target-record',
      'dragged',
    ]);
    expect(store.get(recordAtom)).toMatchObject({ stage: 'WON', position: 2 });
    expect(
      store.get(recordStoreFamilyState.atomFamily('before')),
    ).toMatchObject({ stage: 'NEW', position: 1 });
  });

  it('preserves unrelated record edits and newly loaded cards when rolling back', async () => {
    let rejectSave!: (error: Error) => void;
    updateOneRecord.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    const { store, result } = setup();
    let update!: Promise<void>;

    act(() => {
      update = result.current.updateDroppedRecordOnBoard(
        { recordId: 'dragged', position: 4 },
        'WON',
      );
    });
    const rejection = expect(update).rejects.toThrow('Save failed');

    act(() => {
      store.set(recordAtom, {
        ...store.get(recordAtom)!,
        name: 'Updated name',
      });
      store.set(groupAtom('target'), (ids) => [...ids, 'newly-loaded']);
    });
    await act(async () => {
      rejectSave(new Error('Save failed'));
      await rejection;
    });

    expect(store.get(groupAtom('source'))).toEqual([
      'before',
      'dragged',
      'after',
    ]);
    expect(store.get(groupAtom('target'))).toEqual([
      'target-record',
      'newly-loaded',
    ]);
    expect(store.get(recordAtom)).toEqual({
      ...initialRecord,
      name: 'Updated name',
    });
  });
});
