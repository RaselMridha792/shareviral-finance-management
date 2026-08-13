import { Injectable, NotFoundException } from "@nestjs/common";
import {
  chatTitleFrom,
  type AiChat,
  type AiChatSummary,
  type AiIntakeReply,
  type AiMessage,
} from "@finance/shared";
import { and, desc, eq } from "drizzle-orm";

import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { aiChats } from "../../db/schema";

/**
 * The history list down the side of the assistant.
 *
 * Every query here carries `userId = actor.id` in its where clause, not as a
 * check afterwards. A conversation can quote real figures, so "whose is it" is
 * not a display concern: there is deliberately no method on this service that
 * can return a row belonging to somebody else, which means no future caller can
 * forget to pass the actor.
 */
@Injectable()
export class AiChatsService {
  constructor(private readonly db: DbService) {}

  /** Newest first, without the transcripts — a list does not need them. */
  async list(actor: AuthenticatedUser): Promise<AiChatSummary[]> {
    const rows = await this.db.client
      .select({
        id: aiChats.id,
        title: aiChats.title,
        updatedAt: aiChats.updatedAt,
      })
      .from(aiChats)
      .where(eq(aiChats.userId, actor.id))
      .orderBy(desc(aiChats.updatedAt))
      .limit(100);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<AiChat> {
    const [row] = await this.db.client
      .select()
      .from(aiChats)
      .where(and(eq(aiChats.id, id), eq(aiChats.userId, actor.id)))
      .limit(1);

    // Somebody else's conversation and one that never existed give the same
    // answer, so this cannot be used to find out what other people have asked.
    if (!row) throw new NotFoundException("That conversation is not here.");

    return {
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      messages: row.messages,
      reply: (row.reply as AiIntakeReply | null) ?? null,
    };
  }

  /**
   * Writes the exchange after a turn, starting the conversation if this was the
   * first thing said.
   *
   * Returns the id either way, so the browser learns which conversation it is
   * in from the reply rather than having to create one first.
   */
  async record(
    chatId: string | undefined,
    messages: AiMessage[],
    reply: AiIntakeReply,
    actor: AuthenticatedUser,
  ): Promise<string> {
    const now = new Date();

    if (chatId) {
      const [updated] = await this.db.client
        .update(aiChats)
        .set({ messages, reply, updatedAt: now })
        .where(and(eq(aiChats.id, chatId), eq(aiChats.userId, actor.id)))
        .returning({ id: aiChats.id });

      // Deleted from another tab mid-conversation: fall through and start a
      // new one rather than losing what was just said.
      if (updated) return updated.id;
    }

    const first = messages.find((m) => m.role === "user")?.content ?? "";
    const [created] = await this.db.client
      .insert(aiChats)
      .values({
        userId: actor.id,
        title: chatTitleFrom(first),
        messages,
        reply,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: aiChats.id });

    return created.id;
  }

  /**
   * Gone means gone.
   *
   * This is a transcript, not a financial record — nothing in the books depends
   * on it, so there is no reason to keep a soft-deleted copy of figures the
   * person has asked to be rid of.
   */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const deleted = await this.db.client
      .delete(aiChats)
      .where(and(eq(aiChats.id, id), eq(aiChats.userId, actor.id)))
      .returning({ id: aiChats.id });

    if (!deleted.length) {
      throw new NotFoundException("That conversation is not here.");
    }
  }

  async clear(actor: AuthenticatedUser): Promise<{ deleted: number }> {
    const deleted = await this.db.client
      .delete(aiChats)
      .where(eq(aiChats.userId, actor.id))
      .returning({ id: aiChats.id });

    return { deleted: deleted.length };
  }
}
