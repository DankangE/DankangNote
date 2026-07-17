import { CreateOrganization } from '@clerk/nextjs';
import { Heading } from '@astryxdesign/core/Heading';
import { Stack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';

// 로그인은 했지만 활성 워크스페이스(조직)가 없을 때. 노트는 조직에 속하므로
// 먼저 하나 만들거나 초대를 수락해야 한다.
export function NoOrganization() {
  return (
    <Stack
      direction="vertical"
      gap={4}
      maxWidth={480}
      padding={6}
      style={{ margin: '0 auto' }}
    >
      <Stack direction="vertical" gap={1}>
        <Heading level={2}>워크스페이스를 만들어 주세요</Heading>
        <Text color="secondary">
          노트는 워크스페이스(조직)에 속합니다. 먼저 하나 만들거나 받은 초대를 수락하세요.
        </Text>
      </Stack>
      <CreateOrganization />
    </Stack>
  );
}
