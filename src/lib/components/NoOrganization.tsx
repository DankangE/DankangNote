import { CreateOrganization } from '@clerk/nextjs';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { CenteredPage } from './CenteredPage';

// 로그인은 했지만 활성 워크스페이스(조직)가 없을 때. 모든 작업 공간(노트·멤버 등)은
// 조직 단위이므로 먼저 하나 만들거나 초대를 수락해야 한다.
export function NoOrganization() {
  return (
    <CenteredPage maxWidth={480} gap={4}>
      <Stack direction="vertical" gap={1}>
        <Heading level={2}>워크스페이스를 만들어 주세요</Heading>
        <Text color="secondary">
          DankangNote의 작업 공간은 워크스페이스(조직) 단위입니다. 먼저 하나 만들거나 받은
          초대를 수락하세요.
        </Text>
      </Stack>
      <CreateOrganization />
    </CenteredPage>
  );
}
