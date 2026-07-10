import { Button } from "@astryxdesign/core/Button";

// Astryx 렌더 검증용 임시 페이지 (동작 확인 후 삭제 예정)
export default function AstryxTestPage() {
  return (
    <main style={{ padding: 48, display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>Astryx 렌더 테스트</h1>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Button label="Primary" variant="primary" />
        <Button label="Secondary" variant="secondary" />
        <Button label="Ghost" variant="ghost" />
        <Button label="Destructive" variant="destructive" />
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button label="Small" size="sm" variant="primary" />
        <Button label="Medium" size="md" variant="primary" />
        <Button label="Large" size="lg" variant="primary" />
      </div>
    </main>
  );
}
