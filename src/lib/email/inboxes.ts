import { and, asc, eq, ne } from "drizzle-orm";

import type { AppDb } from "#/db/index";
import { inboxes } from "#/db/schema";

import { createInboxId } from "./ids";

const RESERVED_INBOX_ALIASES = new Set([
  "abuse",
  "admin",
  "billing",
  "contact",
  "help",
  "hostmaster",
  "info",
  "marketing",
  "no-reply",
  "noreply",
  "postmaster",
  "privacy",
  "root",
  "sales",
  "security",
  "support",
  "system",
  "webmaster",
  "koushik",
  "kdawg",
]);

const INBOX_ALIAS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class InboxAliasValidationError extends Error {}

export class InboxAliasConflictError extends Error {}

export function normalizeInboxAlias(alias: string) {
  return alias.trim().toLowerCase();
}

export function validateInboxAlias(alias: string) {
  const normalizedAlias = normalizeInboxAlias(alias);

  if (normalizedAlias.length < 3 || normalizedAlias.length > 32) {
    throw new InboxAliasValidationError(
      "Inbox aliases must be 3-32 characters long.",
    );
  }

  if (!INBOX_ALIAS_PATTERN.test(normalizedAlias)) {
    throw new InboxAliasValidationError(
      "Inbox aliases may only use lowercase letters, numbers, and hyphens.",
    );
  }

  if (RESERVED_INBOX_ALIASES.has(normalizedAlias)) {
    throw new InboxAliasValidationError("That inbox alias is reserved.");
  }

  return normalizedAlias;
}

export function createDefaultInboxLocalPart(inboxId: string) {
  if (!inboxId.startsWith("in_")) {
    throw new Error('Expected inbox IDs to start with "in_".');
  }

  return `u_${inboxId.slice(3)}`;
}

export async function listInboxesForUser(database: AppDb, userId: string) {
  return database
    .select()
    .from(inboxes)
    .where(eq(inboxes.userId, userId))
    .orderBy(asc(inboxes.createdAt), asc(inboxes.id));
}

export async function getInboxForUser(
  database: AppDb,
  userId: string,
  inboxId: string,
) {
  const [inbox] = await database
    .select()
    .from(inboxes)
    .where(and(eq(inboxes.userId, userId), eq(inboxes.id, inboxId)))
    .limit(1);

  return inbox ?? null;
}

export async function createInboxForUser(database: AppDb, userId: string) {
  const inboxId = createInboxId();

  await database.insert(inboxes).values({
    id: inboxId,
    userId,
    defaultLocalPart: createDefaultInboxLocalPart(inboxId),
    customLocalPart: null,
    isActive: true,
  });

  const createdInbox = await getInboxForUser(database, userId, inboxId);

  if (!createdInbox) {
    throw new Error("Failed to create inbox.");
  }

  return createdInbox;
}

export async function provisionInitialInbox(database: AppDb, userId: string) {
  const [existingInbox] = await database
    .select()
    .from(inboxes)
    .where(eq(inboxes.userId, userId))
    .limit(1);

  return existingInbox ?? createInboxForUser(database, userId);
}

export async function updateInboxAliasForUser(
  database: AppDb,
  userId: string,
  inboxId: string,
  alias: string | null,
) {
  const inbox = await getInboxForUser(database, userId, inboxId);

  if (!inbox) {
    return null;
  }

  const normalizedAlias = alias === null ? null : validateInboxAlias(alias);

  if (normalizedAlias) {
    const [existingAlias] = await database
      .select({ id: inboxes.id })
      .from(inboxes)
      .where(
        and(
          eq(inboxes.customLocalPart, normalizedAlias),
          ne(inboxes.id, inboxId),
        ),
      )
      .limit(1);

    if (existingAlias) {
      throw new InboxAliasConflictError("That inbox alias is already taken.");
    }
  }

  await database
    .update(inboxes)
    .set({ customLocalPart: normalizedAlias })
    .where(and(eq(inboxes.userId, userId), eq(inboxes.id, inboxId)));

  return getInboxForUser(database, userId, inboxId);
}

export function serializeInbox(inbox: typeof inboxes.$inferSelect) {
  return {
    id: inbox.id,
    userId: inbox.userId,
    defaultLocalPart: inbox.defaultLocalPart,
    customLocalPart: inbox.customLocalPart,
    isActive: inbox.isActive,
    createdAt: inbox.createdAt.toISOString(),
    updatedAt: inbox.updatedAt.toISOString(),
  };
}
