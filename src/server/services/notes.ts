import 'server-only';

import { prisma } from '@/server/db';
import { Prisma } from '@/server/generated/prisma/client';
import type { Note, User } from '@/server/generated/prisma/client';
import { assertNotTombstoned } from '@/server/services/clerk-tombstone';
import { orgSkeleton, userSkeleton } from '@/server/services/skeleton';
import {
  collectUnreferenced,
  InvalidNoteAttachmentError,
  syncNoteAttachments,
} from '@/server/services/note-attachments';

export interface NoteInput {
  title: string;
  content?: string;
}

// 생성 전용 입력 — parentId(KAN-37)는 update 경로에 섞지 않는다. 부모 변경은 형제 재정렬과
// 사이클 검사가 따라붙는 구조 변이라 moveNote(note-tree.ts)만이 유일한 경로다.
export interface CreateNoteInput extends NoteInput {
  parentId?: string | null;
}

// 노트 수정·삭제 요청자. isAdmin은 Clerk 세션 클레임 기반(auth.ts) — 미러 role은 안 쓴다(KAN-18).
export interface NoteActor {
  userId: string;
  isAdmin: boolean;
}

// 소유권 where — admin은 org의 모든 노트, 그 외엔 본인(authorId) 노트만. authorId가 null인
// 소급 이전 노트는 member의 authorId 조건에 안 걸리므로 admin만 수정·삭제할 수 있다(정책).
// 이동(note-tree.ts)도 같은 판정을 쓴다 — 구조 변이도 노트 행의 update다.
export function ownedNoteWhere(orgId: string, id: string, actor: NoteActor) {
  return actor.isAdmin
    ? { id, orgId }
    : { id, orgId, authorId: actor.userId };
}

// 작성자는 표시에 필요한 최소 필드만 노출한다 (미러 User의 imageUrl 등은 아직 불필요).
const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, email: true } as const;

export type NoteAuthor = Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
// author: 소급 이전 노트·탈퇴 작성자(SetNull)는 null.
export type NoteWithAuthor = Note & { author: NoteAuthor | null };

export function getNote(orgId: string, id: string): Promise<NoteWithAuthor | null> {
  return prisma.note.findFirst({
    where: { id, orgId },
    include: { author: { select: AUTHOR_SELECT } },
  });
}

// 생성 결과 — 부모 지정(KAN-37)의 '그 부모가 이 org에 없다', 이미지(KAN-38)의 '본문이
// 참조한 첨부를 이 노트에 묶을 수 없다'가 실패 경로다.
export type CreateOutcome =
  | { status: 'ok'; note: NoteWithAuthor }
  | { status: 'invalidparent' }
  | { status: 'invalidattachment' };

// 생성은 org/작성자 스켈레톤 생성(create-if-absent)과 한 트랜잭션 — webhook이 아직
// 미러를 채우기 전이어도 FK가 성립한다(부트스트랩 경합 회피, KAN-11 멤버십과 동일 패턴).
// 스켈레톤의 실제 값(name·이메일 등)은 webhook 이벤트가 나중에 채운다.
// upsert가 아닌 createMany+skipDuplicates인 이유: Prisma 7 쿼리 컴파일러는 upsert를
// SELECT→INSERT로 에뮬레이션해 동시 생성 시 P2002로 죽지만, 이 형태는 네이티브
// INSERT ... ON CONFLICT DO NOTHING으로 컴파일된다.
export async function createNote(
  orgId: string,
  authorId: string,
  input: CreateNoteInput,
  // 본문이 참조하는 첨부 id(KAN-38) — 액션이 검증된 doc에서 뽑아 넘긴다.
  attachmentIds: string[] = [],
): Promise<CreateOutcome> {
  // 삭제된 워크스페이스/사용자를 stale 세션(토큰 만료 전)이 스켈레톤으로 부활시키지
  // 않도록 tombstone을 pre/post 이중 확인한다(KAN-12, clerk-sync upsert와 같은 패턴).
  // pre-check만으로는 부족하다 — 확인과 쓰기 사이에 삭제가 커밋되면 cascade는 이미 끝난
  // 뒤라 아래 트랜잭션이 스켈레톤과 노트를 되살린다. 걸리면 throw — 액션의 guarded()가
  // 일반 오류로 변환하고, 세션은 곧 만료된다.
  // pre-check도 정리를 겸한다(clerk-sync와 동일) — 이전 시도가 post-check 전에 죽어 남긴
  // 부활 잔재를 다음 시도가 치운다. Server Action은 웹훅과 달리 재전송이 없어 이 경로가
  // 크래시 잔재의 확정적 치유 기회다. org 삭제는 cascade로 노트까지 정리한다.
  await assertNotTombstoned([orgId, authorId]);

  // 부모는 이 org의 노트여야 한다(KAN-37) — 확인 없이 붙이면 남의 워크스페이스 트리에
  // 문서를 매다는 교차 테넌트 쓰기가 된다. 확인과 INSERT 사이에 부모가 지워지는 경합은
  // parentId FK 위반으로 트랜잭션째 죽고 guarded가 일반 오류로 흡수한다(fail-closed).
  const { title, content, parentId = null } = input;
  if (parentId !== null) {
    const parent = await prisma.note.findFirst({
      where: { id: parentId, orgId },
      select: { id: true },
    });
    if (!parent) return { status: 'invalidparent' };
  }

  // 형제 그룹 끝에 붙인다 = max(position)+1 (보드 KAN-17과 같은 패턴). 동시 생성이 같은
  // 번호를 받을 수 있지만 (position, createdAt) 복합 정렬이 순서를 결정적으로 유지한다.
  const { _max } = await prisma.note.aggregate({
    where: { orgId, parentId },
    _max: { position: true },
  });
  const position = (_max.position ?? -1) + 1;

  let note: NoteWithAuthor;
  try {
    // KAN-38에서 배열 → 대화형 트랜잭션으로: 첨부 바인딩(syncNoteAttachments)이 생성과
    // 원자적이어야 한다. 스켈레톤 헬퍼는 tx 클라이언트를 받는다(skeleton.ts 주석).
    note = await prisma.$transaction(async (tx) => {
      await orgSkeleton(orgId, tx);
      await userSkeleton(authorId, tx);
      const created = await tx.note.create({
        data: { title, content, parentId, position, orgId, authorId },
        include: { author: { select: AUTHOR_SELECT } },
      });
      await syncNoteAttachments(tx, orgId, authorId, created.id, attachmentIds);
      return created;
    });
  } catch (error) {
    if (error instanceof InvalidNoteAttachmentError) {
      return { status: 'invalidattachment' };
    }
    throw error;
  }

  // post-check — 방금 되살렸을 수 있는 것들을 자가 정리(org 삭제는 cascade로 노트까지).
  // post-check가 tombstone 커밋보다 앞서는 문장 단위 인터리빙은 delete 핸들러의 커밋 후
  // sweep이 이어받는다 — clerk-sync 상단 수렴 논증 참조.
  await assertNotTombstoned([orgId, authorId], async () => {
    await prisma.note.deleteMany({ where: { id: note.id } });
  });

  return { status: 'ok', note };
}

// 수정·삭제 결과 — 권한 없음(forbidden)과 미존재(notfound)를 구분해 액션이 알맞은 문구를
// 준다. 보안 경계는 아래 where의 소유권 조건(원자 write)이고, 이 구분은 메시지용이다.
export type UpdateOutcome =
  | { status: 'ok'; note: NoteWithAuthor }
  | { status: 'forbidden' }
  | { status: 'notfound' }
  | { status: 'invalidattachment' };

export type DeleteOutcome = 'ok' | 'forbidden' | 'notfound';

// update/delete 모두 where에 orgId를 포함해 타 워크스페이스 접근을 막고, 소유권 조건까지
// 실어 권한을 쿼리 수준에서 강제한다(KAN-18). update는 확장 where-unique로 단건 원자 실행 —
// updateMany 후 재조회하면 그 사이 삭제와 경합해 성공한 수정을 실패로 보고할 수 있다.
export async function updateNote(
  orgId: string,
  id: string,
  input: Partial<NoteInput>,
  actor: NoteActor,
  // 본문이 참조하는 첨부 id(KAN-38) — content가 없는 부분 수정(제목만)에서는 무시된다.
  attachmentIds: string[] = [],
): Promise<UpdateOutcome> {
  try {
    // 첨부 바인딩·미참조 정리는 본문 저장과 원자적이어야 한다 — 그래서 KAN-38에서 단문
    // update를 대화형 트랜잭션으로 바꿨다. 바인딩 문장만 조건부다(제목만 바꾸는 수정은
    // 참조 목록을 들고 오지 않으므로, 돌렸다간 멀쩡한 첨부를 미참조로 보고 지운다).
    const note = await prisma.$transaction(async (tx) => {
      const updated = await tx.note.update({
        where: ownedNoteWhere(orgId, id, actor),
        data: input,
        include: { author: { select: AUTHOR_SELECT } },
      });
      if (input.content !== undefined) {
        await syncNoteAttachments(tx, orgId, actor.userId, id, attachmentIds);
      }
      return updated;
    });
    return { status: 'ok', note };
  } catch (error) {
    if (error instanceof InvalidNoteAttachmentError) {
      return { status: 'invalidattachment' };
    }
    // P2025: 조건에 맞는 레코드 없음. 소유권 때문인지(권한) 노트가 없어서인지(미존재) 구분.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      const exists = await prisma.note.findFirst({ where: { id, orgId }, select: { id: true } });
      return { status: exists ? 'forbidden' : 'notfound' };
    }
    throw error;
  }
}

export async function deleteNote(
  orgId: string,
  id: string,
  actor: NoteActor,
): Promise<DeleteOutcome> {
  return prisma.$transaction(async (tx) => {
    // 노트 행 잠금(KAN-38) — 이 노트에 대한 동시 저장과 직렬화한다. 첨부 쪽 경합은 이
    // 잠금이 막지 못한다(KAN-71: 참조가 노트 경계를 넘으므로 다른 노트가 같은 첨부를
    // 바인딩하는 것은 이 행과 무관하다) — 그건 collectUnreferenced의 첨부 행 잠금이 막는다.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Note" WHERE "id" = ${id} AND "orgId" = ${orgId} FOR UPDATE`;
    if (locked.length === 0) return 'notfound';

    // 이 노트가 참조하던 첨부를 먼저 적어 둔다 — 노트를 지우면 참조 행이 cascade로
    // 사라져 '무엇이 고아가 됐는지' 알 방법이 없어진다.
    const referenced = await tx.noteAttachmentRef.findMany({
      where: { noteId: id },
      select: { attachmentId: true },
    });
    const { count } = await tx.note.deleteMany({ where: ownedNoteWhere(orgId, id, actor) });
    if (count === 0) return 'forbidden';
    // 참조가 0이 된 것만 지우고 키를 outbox(KAN-70)에 적는다. 다른 노트가 같은 이미지를
    // 쓰고 있으면 남긴다 — 1:1 시절에는 여기서 남의 문서가 쓰는 오브젝트까지 지웠다(KAN-71).
    // enqueue는 삭제가 확정된 뒤에만 커밋된다(같은 트랜잭션 — forbidden이면 통째로 버려진다).
    await collectUnreferenced(tx, orgId, referenced.map((row) => row.attachmentId));
    return 'ok';
  });
}
