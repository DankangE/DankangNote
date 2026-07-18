import { Stack } from '@astryxdesign/core/Stack';
import type { SpacingStep } from '@astryxdesign/core/Layout';
import type { ReactNode } from 'react';

// 페이지 콘텐츠를 중앙 정렬하는 공용 컨테이너 — margin auto 센터링을 한 곳에 모은다.
export function CenteredPage({
  children,
  maxWidth = 720,
  gap = 5,
}: {
  children: ReactNode;
  maxWidth?: number;
  gap?: SpacingStep;
}) {
  return (
    <Stack
      direction="vertical"
      gap={gap}
      maxWidth={maxWidth}
      padding={6}
      style={{ margin: '0 auto' }}
    >
      {children}
    </Stack>
  );
}
