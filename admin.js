// 일반 <script> 태그(모듈 아님) 버전. Firestore/Auth compat API를 사용한다.

let _adminDb = null;
let _adminAuth = null;
let _renderRun = 0; // 대시보드를 몇 번째로 그리는 중인지 세는 번호

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
      const run = ++_renderRun; // 이번 갱신의 번호
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const list = document.getElementById("admin-item-list");
      const cards = []; // 카드를 먼저 다 만든 뒤, 마지막에 한 번에 화면에 붙인다

      for (const item of items) {
        const itemRef = _adminDb.collection("items").doc(item.id);
        const [privateSnap, claimSnap] = await Promise.all([
          itemRef.collection("private").doc("data").get(),
          // 지금 처리 중인 신고(activeClaimId) 한 건만 가져온다. 없으면 null.
          item.activeClaimId
            ? itemRef.collection("claims").doc(item.activeClaimId).get()
            : Promise.resolve(null),
        ]);
        const privateFeatures = privateSnap.exists ? privateSnap.data().features : [];
        const claim = claimSnap && claimSnap.exists ? claimSnap.data() : null;

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
                claim
                  ? `<div class="claim-entry">
                  <p>${escapeHtml(claim.name)} (${escapeHtml(claim.grade)})</p>
                  <p>"${escapeHtml(claim.guess)}"</p>
                </div>`
                  : '<p class="hint">이전 버전으로 접수된 건이에요. 반려한 뒤 다시 신고를 받아주세요.</p>'
              }
            </div>
          </div>
          <div class="admin-actions"></div>
        `;

        const actions = card.querySelector(".admin-actions");

        const approveBtn = document.createElement("button");
        approveBtn.className = "primary-btn";
        approveBtn.textContent = "인계 승인 (최종 완료 처리)";
        // 승인은 신고자가 "찾으러 간다고 알리기"를 눌러 확인중(VERIFYING)이 된 뒤에만 가능하다.
        const canApprove = item.status === ITEM_STATES.VERIFYING && claim;
        approveBtn.disabled = !canApprove;
        approveBtn.addEventListener("click", () => approveItem(item));
        actions.appendChild(approveBtn);

        const rejectBtn = document.createElement("button");
        rejectBtn.className = "ghost-btn";
        rejectBtn.textContent = "반려 (목록으로 되돌리기)";
        rejectBtn.addEventListener("click", () => rejectItem(item));
        actions.appendChild(rejectBtn);

        if (item.status === ITEM_STATES.CLAIMED && claim) {
          const wait = document.createElement("p");
          wait.className = "hint";
          wait.textContent = "신고자가 '찾으러 간다고 알리기'를 누르면 승인할 수 있어요.";
          card.appendChild(wait);
        }

        cards.push(card);
      }

      // 카드를 만드는 동안 더 새로운 갱신이 들어왔다면, 이번 결과는 버린다(카드가 두 번 붙는 것 방지)
      if (run !== _renderRun) return;

      list.innerHTML = "";
      if (cards.length === 0) {
        list.innerHTML = '<p class="empty-state">처리할 신고가 없습니다.</p>';
        return;
      }
      cards.forEach((card) => list.appendChild(card));
    });
}

async function approveItem(item) {
  // COMPLETED로의 전이는 이 관리자 화면에서만 호출되며,
  // firestore.rules 역시 admins 컬렉션에 등록된 사용자만 이 전이를 허용한다.
  // 즉 "관리자 승인 없이는 인계완료에 도달할 수 없다"는 것이
  // 클라이언트 코드와 서버 보안 규칙 양쪽에서 보장된다.
  if (!item.activeClaimId) {
    alert("처리 중인 신고 정보가 없어 승인할 수 없어요. 반려 후 다시 신고를 받아주세요.");
    return;
  }
  try {
    const itemRef = _adminDb.collection("items").doc(item.id);
    // 배치: 여러 쓰기를 한 번에 묶어서, 모두 성공하거나 모두 실패하게 한다.
    const batch = _adminDb.batch();
    batch.update(itemRef, { status: nextState(item.status, ITEM_STATES.COMPLETED) });
    // 승인된 신고는 이 한 건뿐이라는 것을 신고 문서에도 남긴다.
    batch.update(itemRef.collection("claims").doc(item.activeClaimId), { status: "APPROVED" });
    await batch.commit();
  } catch (err) {
    console.error(err);
    alert("승인 처리 중 오류가 발생했습니다: " + err.message);
  }
}

async function rejectItem(item) {
  try {
    const itemRef = _adminDb.collection("items").doc(item.id);
    const batch = _adminDb.batch();
    batch.update(itemRef, {
      status: nextState(item.status, ITEM_STATES.REGISTERED),
      // 처리 중인 신고 표시를 지워서, 다음 신고자가 새로 시작할 수 있게 한다.
      activeClaimId: firebase.firestore.FieldValue.delete(),
    });
    if (item.activeClaimId) {
      batch.update(itemRef.collection("claims").doc(item.activeClaimId), { status: "REJECTED" });
    }
    await batch.commit();
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
