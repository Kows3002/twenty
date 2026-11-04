import { render, screen } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { type ReactNode } from 'react';

import { getDefaultObjectPermissions } from '@/object-metadata/utils/getDefaultObjectPermissions';
import { type ObjectPermissionsWithObjectMetadataId } from '@/object-metadata/types/ObjectPermissionsWithObjectMetadataId';
import { RecordBoardContext } from '@/object-record/record-board/contexts/RecordBoardContext';
import { RecordBoardCardContextProvider } from '@/object-record/record-board/record-board-card/components/RecordBoardCardContextProvider';
import { RecordBoardColumnContext } from '@/object-record/record-board/record-board-column/contexts/RecordBoardColumnContext';
import { RecordBoardComponentInstanceContext } from '@/object-record/record-board/states/contexts/RecordBoardComponentInstanceContext';
import { isRecordBoardCellsNonEditableComponentState } from '@/object-record/record-board/states/isRecordBoardCellsNonEditableComponentState';
import { isRecordBoardDropProcessingComponentState } from '@/object-record/record-board/states/isRecordBoardDropProcessingComponentState';
import { RecordGroupDefinitionType } from '@/object-record/record-group/types/RecordGroupDefinition';
import { recordStoreFamilyState } from '@/object-record/record-store/states/recordStoreFamilyState';
import { getMockObjectMetadataItemOrThrow } from '~/testing/utils/getMockObjectMetadataItemOrThrow';

const INSTANCE_ID = 'board';
const mockObjectMetadataItem = getMockObjectMetadataItemOrThrow('opportunity');
const mockStageField = mockObjectMetadataItem.fields.find(
  (field) => field.name === 'stage',
)!;
let mockObjectPermissions: ObjectPermissionsWithObjectMetadataId;

jest.mock('@/object-metadata/hooks/useObjectMetadataItemById', () => ({
  useObjectMetadataItemById: () => ({
    objectMetadataItem: mockObjectMetadataItem,
  }),
}));
jest.mock('@/object-record/hooks/useObjectPermissionsForObject', () => ({
  useObjectPermissionsForObject: () => mockObjectPermissions,
}));
jest.mock('@/object-record/hooks/useObjectPermissions', () => ({
  useObjectPermissions: () => ({
    objectPermissionsByObjectMetadataId: {
      [mockObjectMetadataItem.id]: mockObjectPermissions,
    },
  }),
}));
jest.mock(
  '@/object-record/record-board/record-board-card/components/RecordBoardCard',
  () => ({
    RecordBoardCard: () => <span>Deal</span>,
  }),
);
jest.mock(
  '@/object-record/record-board/record-board-card/components/RecordBoardCardHotkeysEffect',
  () => ({
    RecordBoardCardHotkeysEffect: () => null,
  }),
);
jest.mock(
  '@/ui/utilities/drag-and-drop/components/DragDropItemSortableCell',
  () => ({
    DragDropItemSortableCell: ({
      disabled,
      children,
    }: {
      disabled: boolean;
      children: ReactNode;
    }) => (
      <button type="button" disabled={disabled}>
        {children}
      </button>
    ),
  }),
);

const renderCard = ({
  isWidgetReadOnly = false,
  isDropProcessing = false,
  isDeleted = false,
} = {}) => {
  const store = createStore();
  store.set(
    isRecordBoardCellsNonEditableComponentState.atomFamily({
      instanceId: INSTANCE_ID,
    }),
    isWidgetReadOnly,
  );
  store.set(
    isRecordBoardDropProcessingComponentState.atomFamily({
      instanceId: INSTANCE_ID,
    }),
    isDropProcessing,
  );
  store.set(recordStoreFamilyState.atomFamily('deal'), {
    id: 'deal',
    __typename: 'Opportunity',
    deletedAt: isDeleted ? '2026-01-01T00:00:00Z' : null,
  });
  const columnDefinition = {
    id: 'new',
    value: 'NEW',
    title: 'New',
    type: RecordGroupDefinitionType.Value,
    color: 'blue' as const,
    position: 0,
    isVisible: true,
  };

  render(
    <JotaiProvider store={store}>
      <RecordBoardComponentInstanceContext.Provider
        value={{ instanceId: INSTANCE_ID }}
      >
        <RecordBoardContext.Provider
          value={{
            objectMetadataItem: mockObjectMetadataItem,
            selectFieldMetadataItem: mockStageField,
            objectPermissions: mockObjectPermissions,
            recordBoardId: INSTANCE_ID,
            createOneRecord: jest.fn(),
            updateOneRecord: jest.fn(),
            deleteOneRecord: jest.fn(),
          }}
        >
          <RecordBoardColumnContext.Provider
            value={{
              columnDefinition,
              columnId: 'new',
              columnIndex: 0,
              recordIds: ['deal'],
            }}
          >
            <RecordBoardCardContextProvider
              recordId="deal"
              rowIndex={0}
              group="new"
            />
          </RecordBoardColumnContext.Provider>
        </RecordBoardContext.Provider>
      </RecordBoardComponentInstanceContext.Provider>
    </JotaiProvider>,
  );
  return screen.getByRole('button', { name: 'Deal' });
};

describe('RecordBoardCardContextProvider drag permissions', () => {
  beforeEach(() => {
    mockObjectPermissions = getDefaultObjectPermissions(
      mockObjectMetadataItem.id,
    );
    mockStageField.isUIEditable = true;
  });

  it('allows dragging when the record and group field can be edited', () => {
    expect(renderCard()).toBeEnabled();
  });

  it('disables dragging for a role that can only read opportunities', () => {
    mockObjectPermissions.canUpdateObjectRecords = false;
    expect(renderCard()).toBeDisabled();
  });

  it('disables dragging when Stage is update-restricted', () => {
    mockObjectPermissions.restrictedFields = {
      [mockStageField.id]: { canUpdate: false },
    };
    expect(renderCard()).toBeDisabled();
  });

  it('disables dragging when the grouping field is not UI editable', () => {
    mockStageField.isUIEditable = false;
    expect(renderCard()).toBeDisabled();
  });

  it('allows dragging when only an unrelated field is update-restricted', () => {
    const nameField = mockObjectMetadataItem.fields.find(
      (field) => field.name === 'name',
    )!;
    mockObjectPermissions.restrictedFields = {
      [nameField.id]: { canUpdate: false },
    };
    expect(renderCard()).toBeEnabled();
  });

  it('keeps dragging disabled on a read-only board widget', () => {
    expect(renderCard({ isWidgetReadOnly: true })).toBeDisabled();
  });

  it('disables dragging while a previous drop is being saved', () => {
    expect(renderCard({ isDropProcessing: true })).toBeDisabled();
  });

  it('disables dragging for a deleted record', () => {
    expect(renderCard({ isDeleted: true })).toBeDisabled();
  });
});
