'use client';

import { useState, useTransition } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  addCommentAction,
  deleteCommentAction,
  setThreadResolvedAction,
} from '@/features/notes/api/comment-actions';
import { MAX_COMMENT_BODY } from '@/features/notes/comments';
import { authorLabel, noteDateFormat } from '@/features/notes/format';
import type { NoteCommentThreadView } from '@/server/services/note-comments';
import type { NoteViewer } from '@/features/notes/types';
import { FormError } from './FormError';

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

/**
 * 인라인 코멘트 목록 (KAN-40).
 *
 * `anchored`는 본문에 아직 앵커가 남아 있는 스레드다. 앵커를 잃은 스레드도 **지우지 않고
 * 보여준다** — 범위가 지워졌다고 대화가 사라져야 할 값은 아니고, 조용히 감추면 사용자는
 * 남긴 코멘트가 어디로 갔는지 알 수 없다. 다만 '위치를 잃음'으로 표시해 본문에서 찾으려
 * 애쓰지 않게 한다.
 */
export function NoteComments({
  threads,
  anchored,
  viewer,
}: {
  threads: readonly NoteCommentThreadView[];
  anchored: ReadonlySet<string>;
  viewer: NoteViewer | null;
}) {
  const open = threads.filter((thread) => thread.resolvedAt === null);
  const resolved = threads.filter((thread) => thread.resolvedAt !== null);
  const [showResolved, setShowResolved] = useState(false);

  if (threads.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4" aria-label="코멘트">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4" aria-hidden />
        코멘트 {open.length > 0 ? open.length : ''}
      </h2>

      {open.map((thread) => (
        <Thread
          key={thread.id}
          thread={thread}
          anchored={anchored.has(thread.id)}
          viewer={viewer}
        />
      ))}

      {resolved.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            aria-expanded={showResolved}
            onClick={() => setShowResolved((prev) => !prev)}
          >
            해결됨 {resolved.length}개 {showResolved ? '접기' : '보기'}
          </Button>
          {showResolved
            ? resolved.map((thread) => (
                <Thread
                  key={thread.id}
                  thread={thread}
                  anchored={anchored.has(thread.id)}
                  viewer={viewer}
                />
              ))
            : null}
        </div>
      ) : null}
    </section>
  );
}

function Thread({
  thread,
  anchored,
  viewer,
}: {
  thread: NoteCommentThreadView;
  anchored: boolean;
  viewer: NoteViewer | null;
}) {
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isResolved = thread.resolvedAt !== null;

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) setError(result.error ?? GENERIC_ERROR);
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  function handleReply() {
    const body = reply.trim();
    if (!body || isPending) return;
    // 성공하면 revalidate가 새 목록을 내려주므로 입력만 비운다(낙관 갱신은 두지 않는다 —
    // 코멘트는 타이핑처럼 잦지 않아 왕복 한 번이 체감되지 않는다).
    run(async () => {
      const result = await addCommentAction(thread.id, body);
      if (result.ok) setReply('');
      return result;
    });
  }

  return (
    <article
      className={
        isResolved
          ? 'flex flex-col gap-2 rounded-md border border-dashed p-3 opacity-70'
          : 'flex flex-col gap-2 rounded-md border p-3'
      }
    >
      {!anchored ? (
        // 본문에서 앵커가 사라진 스레드. 강조를 찾아 헤매지 않도록 먼저 알린다.
        <p className="text-xs text-warning">본문에서 이 코멘트가 가리키던 부분이 사라졌습니다.</p>
      ) : null}

      {thread.comments.map((comment) => (
        <div key={comment.id} className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">
            {authorLabel(comment.author) || '알 수 없음'} ·{' '}
            {noteDateFormat.format(new Date(comment.createdAt))}
            {viewer && (viewer.isAdmin || comment.authorId === viewer.userId) ? (
              <button
                type="button"
                className="ml-2 underline hover:text-foreground"
                disabled={isPending}
                onClick={() => run(() => deleteCommentAction(comment.id))}
              >
                삭제
              </button>
            ) : null}
          </p>
          {/* 본문은 서식 없는 텍스트다 — 줄바꿈만 보존한다. */}
          <p className="text-sm whitespace-pre-wrap break-words">{comment.body}</p>
        </div>
      ))}

      <FormError message={error} />

      {isResolved ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={isPending}
          onClick={() => run(() => setThreadResolvedAction(thread.id, false))}
        >
          다시 열기
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            value={reply}
            maxLength={MAX_COMMENT_BODY}
            rows={2}
            placeholder="답글…"
            aria-label="답글 입력"
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isPending || reply.trim() === ''} onClick={handleReply}>
              답글
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => run(() => setThreadResolvedAction(thread.id, true))}
            >
              해결
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
