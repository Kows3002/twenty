import { act, renderHook } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { type ReactNode } from 'react';

import { getDefaultObjectPermissions } from '@/object-metadata/utils/getDefaultObjectPermissions';
import { RecordBoardContext } from '@/object-record/record-board/contexts/RecordBoardContext';
import { RecordBoardComponentInstanceContext } from '@/object-record/record-board/states/contexts/RecordBoardComponentInstanceContext';
import { isRecordBoardDropProcessingComponentState } from '@/object-record/record-board/states/isRecordBoardDropProcessingComponentState';
import { useProcessBoardCardDrop } from '@/object-record/record-drag/hooks/useProcessBoardCardDrop';
import { draggedRecordIdsComponentState } from '@/object-record/record-drag/states/draggedRecordIdsComponentState';
import { recordGroupDefinitionFamilyState } from '@/object-record/record-group/states/recordGroupDefinitionFamilyState';
import { RecordGroupDefinitionType } from '@/object-record/record-group/types/RecordGroupDefinition';
import { RecordSelectionComponentInstanceContext } from '@/object-record/record-selection/states/contexts/RecordSelectionComponentInstanceContext';
import { RecordSortsComponentInstanceContext } from '@/object-record/record-sort/states/context/RecordSortsComponentInstanceContext';
import { ViewComponentInstanceContext } from '@/views/states/contexts/ViewComponentInstanceContext';
import { getMockObjectMetadataItemOrThrow } from '~/testing/utils/getMockObjectMetadataItemOrThrow';

const INSTANCE_ID = 'board';
const mockUpdateDroppedRecordOnBoard = jest.fn();

jest.mock(
  '@/object-record/record-drag/hooks/useUpdateDroppedRecordOnBoard',
  () => ({
    useUpdateDroppedRecordOnBoard: () => ({
      updateDroppedRecordOnBoard: mockUpdateDroppedRecordOnBoard,
    }),
  }),
);
jest.mock('@/object-record/record-index/contexts/RecordIndexContext', () => ({
  useRecordIndexContextOrThrow: () => ({ recordIndexId: INSTANCE_ID }),
}));
jest.mock('@/ui/layout/dialog/hooks/useDialog', () => ({
  useDialog: () => ({ openDialog: jest.fn() }),
}));

const objectMetadataItem = getMockObjectMetadataItemOrThrow('opportunity');
const selectFieldMetadataItem = objectMetadataItem.fields.find(
  (field) => field.name === 'stage',
)!;
const processingAtom = isRecordBoardDropProcessingComponentState.atomFamily({
  instanceId: INSTANCE_ID,
});
const draggedIdsAtom = draggedRecordIdsComponentState.atomFamily({
  instanceId: INSTANCE_ID,
});
const getWrapper =
  (store: ReturnType<typeof createStore>) =>
  ({ children }: { children: ReactNode }) => (
    <JotaiProvider store={store}>
      <ViewComponentInstanceContext.Provider
        value={{ instanceId: INSTANCE_ID }}
      >
        <RecordBoardComponentInstanceContext.Provider
          value={{ instanceId: INSTANCE_ID }}
        >
          <RecordSelectionComponentInstanceContext.Provider
            value={{ instanceId: INSTANCE_ID }}
          >
            <RecordSortsComponentInstanceContext.Provider
              value={{ instanceId: INSTANCE_ID }}
            >
              <RecordBoardContext.Provider
                value={{
                  objectMetadataItem,
                  selectFieldMetadataItem,
                  recordBoardId: INSTANCE_ID,
                  createOneRecord: jest.fn(),
                  updateOneRecord: jest.fn(),
                  deleteOneRecord: jest.fn(),
                  objectPermissions: getDefaultObjectPermissions(
                    objectMetadataItem.id,
                  ),
                }}
              >
                {children}
              </RecordBoardContext.Provider>
            </RecordSortsComponentInstanceContext.Provider>
          </RecordSelectionComponentInstanceContext.Provider>
        </RecordBoardComponentInstanceContext.Provider>
      </ViewComponentInstanceContext.Provider>
    </JotaiProvider>
  );

const setup = () => {
  const store = createStore();
  store.set(draggedIdsAtom, ['first', 'second']);
  store.set(recordGroupDefinitionFamilyState.atomFamily('target'), {
    id: 'target',
    value: 'WON',
    title: 'Won',
    type: RecordGroupDefinitionType.Value,
    color: 'blue',
    position: 0,
    isVisible: true,
  });
  const { result } = renderHook(() => useProcessBoardCardDrop(), {
    wrapper: getWrapper(store),
  });
  return { store, result };
};
const drop = {
  draggedRecordId: 'first',
  sourceDroppableId: 'source',
  destinationDroppableId: 'target',
  destinationIndex: 0,
};

describe('useProcessBoardCardDrop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUpdateDroppedRecordOnBoard.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the board locked until every selected card has finished saving', async () => {
    const { store, result } = setup();
    let finishFirstSave!: () => void;
    mockUpdateDroppedRecordOnBoard
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstSave = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    let save!: Promise<void>;

    act(() => {
      save = result.current.processBoardCardDrop(drop);
    });
    act(() => {
      store.set(draggedIdsAtom, []);
      jest.advanceTimersByTime(1000);
    });
    expect(store.get(processingAtom)).toBe(true);
    expect(mockUpdateDroppedRecordOnBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirstSave();
      await save;
    });
    expect(mockUpdateDroppedRecordOnBoard).toHaveBeenNthCalledWith(
      2,
      { recordId: 'second', position: 2 },
      'WON',
    );
    expect(store.get(processingAtom)).toBe(true);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(store.get(processingAtom)).toBe(false);
  });

  it('unlocks after a rejected save and does not start the remaining moves', async () => {
    const { store, result } = setup();
    mockUpdateDroppedRecordOnBoard.mockRejectedValue(
      new Error('Permission denied'),
    );

    await act(async () => {
      await expect(result.current.processBoardCardDrop(drop)).rejects.toThrow(
        'Permission denied',
      );
    });

    expect(mockUpdateDroppedRecordOnBoard).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(store.get(processingAtom)).toBe(false);
  });
});
