import { CreateOrganization } from '@clerk/nextjs';
import { CenteredPage } from './CenteredPage';

// 로그인은 했지만 활성 워크스페이스(조직)가 없을 때. 모든 작업 공간(노트·멤버 등)은
// 조직 단위이므로 먼저 하나 만들거나 초대를 수락해야 한다.
export function NoOrganization() {
  return (
    <CenteredPage className="max-w-lg gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold">워크스페이스를 만들어 주세요</h2>
        <p className="text-muted-foreground">
          DankangNote의 작업 공간은 워크스페이스(조직) 단위입니다. 먼저 하나 만들거나 받은
          초대를 수락하세요.
        </p>
      </div>
      <CreateOrganization />
    </CenteredPage>
  );
}
