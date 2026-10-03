// 일반 <script> 태그(모듈 아님) 버전. Firestore/Auth compat API를 사용한다.

let _adminDb = null;
let _adminAuth = null;

function initAdminView(db, auth) {
  _adminDb = db;
  _adminAuth = auth;
  setupLoginForm();
}

function setupLoginForm() {
  const loginForm = document.getElementById("admin-login-form");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    try {
      await _adminAuth.signInWithEmailAndPassword(formData.get("email"), formData.get("password"));
      const uid = _adminAuth.currentUser.uid;

      // admins 컬렉션에 본인 uid 문서가 있어야만 관리자로 인정한다.
      // (Firestore 콘솔에서 admins/{uid} 빈 문서를 만들어두면 됨)
      const adminDoc = await _adminDb.collection("admins").doc(uid).get();
      if (!adminDoc.exists) {
        await _adminAuth.signOut();
        alert("관리자 권한이 없는 계정입니다.");
        return;
      }

      document.getElementById("admin-login").hidden = true;
      document.getElementById("admin-dashboard").hidden = false;
      listenClaimedItems();
    } catch (err) {
      console.error(err);
      alert("로그인에 실패했습니다: " + err.message);
    }
  });

  document.getElementById("admin-logout").addEventListener("click", async () => {
    await _adminAuth.signOut();
    document.getElementById("admin-dashboard").hidden = true;
    document.getElementById("admin-login").hidden = false;
  });
}

function listenClaimedItems() {
  _adminDb
    .collection("items")
    .where("status", "in", [ITEM_STATES.CLAIMED, ITEM_STATES.VERIFYING])
    .onSnapshot(async (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const list = document.getElementById("admin-item-list");
      list.innerHTML = "";

      if (items.length === 0) {
        list.innerHTML = '<p class="empty-state">처리할 신고가 없습니다.</p>';
        return;
      }

      for (const item of items) {
        const [privateSnap, claimsSnap] = await Promise.all([
          _adminDb.collection("items").doc(item.id).collection("private").doc("data").get(),
          _adminDb.collection("items").doc(item.id).collection("claims").get(),
        ]);
        const privateFeatures = privateSnap.exists ? privateSnap.data().features : [];
        const claims = claimsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const card = document.createElement("article");
        card.className = "admin-card";
        card.innerHTML = `
          <h3>${item.title} <span class="status-tag status-${item.status}">${STATE_LABELS[item.status]}</span></h3>
          <p>${item.place}</p>
          <div class="feature-compare">
            <div>
              <strong>습득자가 등록한 비공개 특징</strong>
              <ul>${privateFeatures.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
            </div>
            <div>
              <strong>신고자 제출 정보</strong>
              ${
                claims
                  .map(
                    (c) => `
                <div class="claim-entry">
                  <p>${escapeHtml(c.name)} (${escapeHtml(c.grade)})</p>
                  <p>"${escapeHtml(c.guess)}"</p>
                </div>`
                  )
                  .join("") || '<p class="hint">아직 제출된 신고가 없습니다.</p>'
              }
            </div>
          </div>
          <div class="admin-actions"></div>
        `;

        const actions = card.querySelector(".admin-actions");

        const approveBtn = document.createElement("button");
        approveBtn.className = "primary-btn";
        approveBtn.textContent = "인계 승인 (최종 완료 처리)";
        approveBtn.addEventListener("click", () => approveItem(item));
        actions.appendChild(approveBtn);

        const rejectBtn = document.createElement("button");
        rejectBtn.className = "ghost-btn";
        rejectBtn.textContent = "반려 (목록으로 되돌리기)";
        rejectBtn.addEventListener("click", () => rejectItem(item));
        actions.appendChild(rejectBtn);

        list.appendChild(card);
      }
    });
}

async function approveItem(item) {
  // COMPLETED로의 전이는 이 관리자 화면에서만 호출되며,
  // firestore.rules 역시 admins 컬렉션에 등록된 사용자만 이 전이를 허용한다.
  // 즉 "관리자 승인 없이는 인계완료에 도달할 수 없다"는 것이
  // 클라이언트 코드와 서버 보안 규칙 양쪽에서 보장된다.
  try {
    await _adminDb.collection("items").doc(item.id).update({
      status: nextState(item.status, ITEM_STATES.COMPLETED),
    });
  } catch (err) {
    console.error(err);
    alert("승인 처리 중 오류가 발생했습니다: " + err.message);
  }
}

async function rejectItem(item) {
  try {
    await _adminDb.collection("items").doc(item.id).update({
      status: nextState(item.status, ITEM_STATES.REGISTERED),
    });
  } catch (err) {
    console.error(err);
    alert("반려 처리 중 오류가 발생했습니다: " + err.message);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
