import { CONTENT_TYPES, type ContentType } from "./content-types.js";

export class ContentHierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentHierarchyError";
  }
}

const allowedParentByType: Record<ContentType, ContentType | null> = {
  [CONTENT_TYPES.SERIES]: null,
  [CONTENT_TYPES.SEASON]: CONTENT_TYPES.SERIES,
  [CONTENT_TYPES.EPISODE]: CONTENT_TYPES.SEASON,
  [CONTENT_TYPES.MOVIE]: null,
};

export function getAllowedParentType(type: ContentType): ContentType | null {
  return allowedParentByType[type];
}

// Enforces the CMS hierarchy before writes reach the self-referencing table.
export function validateContentParent(
  type: ContentType,
  parent: { id: string; type: string } | null,
): void {
  const expectedParentType = getAllowedParentType(type);

  if (expectedParentType === null) {
    if (parent !== null) {
      throw new ContentHierarchyError(`${type} content cannot have a parent.`);
    }

    return;
  }

  if (parent === null) {
    throw new ContentHierarchyError(
      `${type} content must belong to a ${expectedParentType}.`,
    );
  }

  if (parent.type !== expectedParentType) {
    throw new ContentHierarchyError(
      `${type} content must belong to a ${expectedParentType}, but parent ${parent.id} is ${parent.type}.`,
    );
  }
}
