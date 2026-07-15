import {
  CONTENT_TYPES,
  type ContentType,
} from "../shared/domain/domain-contracts.js";
import { DomainError } from "../shared/domain/domain-error.js";

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
      throw new DomainError(
        "INVALID_CONTENT_HIERARCHY",
        `${type} content cannot have a parent.`,
      );
    }

    return;
  }

  if (parent === null) {
    throw new DomainError(
      "INVALID_CONTENT_HIERARCHY",
      `${type} content must belong to a ${expectedParentType}.`,
    );
  }

  if (parent.type !== expectedParentType) {
    throw new DomainError(
      "INVALID_CONTENT_HIERARCHY",
      `${type} content must belong to a ${expectedParentType}, but parent ${parent.id} is ${parent.type}.`,
    );
  }
}
