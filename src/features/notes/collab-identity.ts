// 공동 편집 커서의 신원 해석 (KAN-75). 순수 로직만 둔다 — 여기 규칙은 전부 '무엇을
// 믿는가'에 대한 것이라, 소켓 없이 값만 넣어 확인할 수 있어야 한다.

import type { PresentMember } from '@/features/realtime/presence-members';

/**
 * 커서 색. **사람마다 고정이어야 한다** — 매번 다시 뽑으면 새로고침 한 번에 색이 바뀌어
 * 색으로 사람을 알아보는 것 자체가 성립하지 않는다.
 *
 * 라벨은 이 색을 배경으로 흰 글자를 얹으므로 L을 0.55로 묶어 라이트·다크 양쪽에서 같은
 * 대비가 나오게 했다. hue만 돌리되 sRGB 색역을 벗어나는 자리는 채도를 낮춘다 — 차트
 * 토큰이 `--chart-2`(틸)에서 같은 이유로 그렇게 한다(globals.css).
 */
export const CARET_COLORS = [
  'oklch(0.55 0.22 296)', // 바이올렛 (브랜드)
  'oklch(0.55 0.11 182)', // 틸 — 색역 경계라 채도를 낮췄다
  'oklch(0.55 0.15 70)', // 앰버
  'oklch(0.55 0.2 350)', // 핑크
  'oklch(0.55 0.16 250)', // 블루
  'oklch(0.55 0.13 150)', // 그린
  'oklch(0.55 0.19 25)', // 레드
  'oklch(0.55 0.2 320)', // 마젠타
] as const;

/**
 * userId에서 색을 뽑는다. FNV-1a — 암호 강도가 필요한 자리가 아니라 '같은 입력이면 같은
 * 색'과 '고르게 흩어진다'만 있으면 된다.
 */
export function caretColor(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return CARET_COLORS[hash % CARET_COLORS.length];
}

/** 커서 하나에 붙일 표시 정보. */
export type CaretIdentity = { userId: string; name: string; color: string };

/**
 * Yjs clientId → 사람.
 *
 * **awareness 페이로드의 이름은 이 표에 들어오지 않는다.** 그게 이 클래스가 있는 이유다:
 * awareness 상태는 보낸 쪽이 자유롭게 채우는 값이라, 거기 적힌 이름을 그대로 라벨에 쓰면
 * 같은 워크스페이스의 누구든 남의 이름표를 단 커서를 띄울 수 있다. 이름의 근거는 프레즌스
 * 채널이 실어 보낸 `user_info`뿐이고, 그건 서버가 세션으로 서명한다(규약 5·14, KAN-34가
 * 타이핑에서 세운 선례와 같다).
 *
 * clientId ↔ userId 연결의 근거도 페이로드가 아니라 **Pusher가 클라이언트 이벤트에 붙여
 * 주는 `user_id`**다. 그 값은 구독 인증 서명에서 나오므로 보낸 쪽이 바꿀 수 없다.
 */
export class CaretDirectory {
  /** clientId → userId. 먼저 잡힌 연결이 이긴다(bind 주석 참조). */
  private readonly owners = new Map<number, string>();
  /** userId → 프레즌스가 알려준 사람. */
  private members = new Map<string, PresentMember>();

  /** 구독 성립 시 한 번에 오는 전체 명단으로 갈아끼운다. */
  replaceMembers(list: readonly PresentMember[]): void {
    this.members = new Map(list.map((member) => [member.id, member]));
  }

  addMember(member: PresentMember): void {
    this.members.set(member.id, member);
  }

  /** 이 사람이 채널을 떠났다. 남은 커서를 지우도록 그가 쓰던 clientId를 돌려준다. */
  removeMember(userId: string): number[] {
    this.members.delete(userId);
    const orphaned: number[] = [];
    for (const [clientId, owner] of this.owners) {
      if (owner === userId) {
        orphaned.push(clientId);
      }
    }
    for (const clientId of orphaned) {
      this.owners.delete(clientId);
    }
    return orphaned;
  }

  /** 이 사람이 지금 채널에 있는가. 서명 없는 발신자를 거르는 1차 관문이다. */
  hasMember(userId: string): boolean {
    return this.members.has(userId);
  }

  /**
   * 이 clientId들이 저 사람의 것임을 기록한다. **버려야 할 clientId**를 돌려준다.
   *
   * 먼저 잡힌 연결이 이긴다 — 정직한 클라이언트는 자기 clientId 하나만 실어 보내고 그
   * 번호는 문서를 여는 동안 바뀌지 않으므로, 이미 남의 것으로 알려진 번호가 다른 사람의
   * 업데이트에 실려 오는 건 정상 흐름에 없다. 그걸 덮어쓰게 두면 남의 커서를 자기 이름표로
   * 가로챌 수 있다(규약 18: 복구 경로가 남의 자원을 징발하면 그게 권한 상승이다).
   */
  bind(clientIds: readonly number[], userId: string): number[] {
    const rejected: number[] = [];
    for (const clientId of clientIds) {
      const owner = this.owners.get(clientId);
      if (owner === undefined) {
        this.owners.set(clientId, userId);
      } else if (owner !== userId) {
        rejected.push(clientId);
      }
    }
    return rejected;
  }

  /** 원격에서 사라진 clientId를 잊는다(재접속하면 새 번호로 다시 잡힌다). */
  unbind(clientIds: readonly number[]): void {
    for (const clientId of clientIds) {
      this.owners.delete(clientId);
    }
  }

  /**
   * 이 커서에 붙일 이름·색. 아직 주인을 모르거나 그 사람이 프레즌스에 없으면 null —
   * 호출부는 그때 커서를 그리지 않는다. 이름을 모른다고 '누군가'로 그리면, 신원을 못 세운
   * 커서가 정상 커서와 같은 자리에 같은 모양으로 뜬다.
   */
  resolve(clientId: number): CaretIdentity | null {
    const userId = this.owners.get(clientId);
    if (userId === undefined) {
      return null;
    }
    const member = this.members.get(userId);
    if (member === undefined) {
      return null;
    }
    return { userId, name: member.name, color: caretColor(userId) };
  }
}
