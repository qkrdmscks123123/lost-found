// 일반 <script> 태그(모듈 아님)로 동작하는 버전.
// firebase-config.js, fsm.js, student.js, admin.js가 이 파일보다 먼저 로드되어
// 그 안의 top-level const/function들이 이미 정의된 상태에서 아래 코드가 실행된다.

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage(); // 사진 파일을 올리는 Firebase Storage 도구

// 로그인하지 않은 모든 방문자는 자동으로 익명 로그인됨.
// Firestore 보안 규칙에서 "로그인한 사용자만 쓰기 가능" 조건을 걸 수 있게 해,
// 완전한 비로그인 공개 쓰기보다 한 단계 안전하게 만든다.
auth.signInAnonymously().catch((err) => {
  console.error("익명 로그인 실패:", err);
});

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

function setupModalClose() {
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.classList.contains("modal-close")) {
        modal.hidden = true;
      }
    });
  });
}

setupTabs();
setupModalClose();
initStudentView(db, storage);
initAdminView(db, auth);
