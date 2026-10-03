// 분실물 인계 절차를 유한 상태 기계(FSM)로 정의한 모듈.
// 상태(state)와 허용된 전이(transition)를 코드로 명시해,
// "정의되지 않은 경로로는 상태가 바뀔 수 없다"는 것을 보장한다.
// 같은 규칙은 firestore.rules에도 한 번 더 구현되어 있어,
// 클라이언트 코드를 우회해도 서버(Firestore) 단에서 최종적으로 막힌다.

const ITEM_STATES = Object.freeze({
  REGISTERED: 'REGISTERED', // 습득 등록됨 — 아직 주인을 찾지 못한 상태
  CLAIMED: 'CLAIMED',       // 누군가 "내 물건이에요"라고 신고한 상태
  VERIFYING: 'VERIFYING',   // 신고자가 찾으러 간다고 알린 상태 — 관리자 확인 대기
  COMPLETED: 'COMPLETED',   // 관리자가 최종 승인해 인계가 끝난 상태
});

const STATE_LABELS = {
  REGISTERED: '등록됨',
  CLAIMED: '신고접수',
  VERIFYING: '확인중',
  COMPLETED: '인계완료',
};

// 전이 테이블: key(현재 상태) -> 이동 가능한 상태 목록
// COMPLETED로 가는 경로는 오직 VERIFYING에서만 열려 있고,
// 이 전이는 관리자 화면(js/admin.js)에서만 호출된다.
const TRANSITIONS = {
  REGISTERED: ['CLAIMED'],
  CLAIMED: ['VERIFYING', 'REGISTERED'], // REGISTERED로 되돌아가는 것은 관리자의 반려 처리
  VERIFYING: ['COMPLETED', 'REGISTERED'],
  COMPLETED: [],
};

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

function nextState(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`허용되지 않은 상태 전이입니다: ${from} -> ${to}`);
  }
  return to;
}
