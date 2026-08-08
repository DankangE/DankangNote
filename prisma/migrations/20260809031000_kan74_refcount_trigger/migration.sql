-- KAN-74 자체 리뷰 반영 — refCount 유지를 애플리케이션에서 **트리거로** 옮긴다.
--
-- 앞 마이그레이션은 참조를 바꾸는 자리마다 다시 세는 방식이었다. 리뷰가 그 방식으로는
-- 닫히지 않는 경로를 찾았다: createNote의 tombstone post-check가 `note.deleteMany`로
-- 노트를 지우면 참조 행이 **cascade로** 사라지는데, cascade는 애플리케이션 코드를 거치지
-- 않아 refCount가 옛값으로 굳는다. 그러면 그 첨부는 스윕 후보로 영영 올라오지 못하고
-- 행과 오브젝트가 영구히 남는다(조직 삭제의 프리픽스 정리가 유일한 회수 경로).
--
-- 한 경로만 고치면 다음에 Note를 지우는 코드가 같은 함정을 다시 밟는다(규약 25). 참조 행의
-- 생성·삭제는 **전부** 이 트리거를 거치므로 — 앱이든 cascade든 raw SQL이든 — 부류가 닫힌다.

CREATE OR REPLACE FUNCTION "note_attachment_refcount_sync"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE "NoteAttachment" SET "refCount" = "refCount" + 1 WHERE "id" = NEW."attachmentId";
  ELSE
    -- 첨부 자체가 지워져 참조가 cascade로 따라온 경우엔 부모가 이미 없어 0행이다(정상).
    UPDATE "NoteAttachment" SET "refCount" = "refCount" - 1 WHERE "id" = OLD."attachmentId";
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "NoteAttachmentRef_refcount"
AFTER INSERT OR DELETE ON "NoteAttachmentRef"
FOR EACH ROW EXECUTE FUNCTION "note_attachment_refcount_sync"();

-- 앞 마이그레이션 이후 이 트리거가 붙기 전까지 생겼을 드리프트를 한 번 정리한다.
UPDATE "NoteAttachment" a
SET "refCount" = c.n
FROM (
  SELECT a2."id" AS id, (
    SELECT count(*)::int FROM "NoteAttachmentRef" r WHERE r."attachmentId" = a2."id"
  ) AS n
  FROM "NoteAttachment" a2
) c
WHERE a."id" = c.id AND a."refCount" <> c.n;
