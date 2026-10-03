// 일반 <script> 태그(모듈 아님) 버전. Firestore compat API(db.collection(...))를 사용한다.

let allItems = [];
let _db = null;

function initStudentView(db) {
  _db = db;
  listenItems();
  setupRegisterForm();
  setupSearchFilter();
}

// Firebase Storage(유료 Blaze 요금제 필요)를 쓰지 않고, 사진을 브라우저에서
// 작게 압축해 Firestore 문서 안에 base64 문자열로 직접 저장한다.
// Firestore 문서 하나의 용량 제한(1MB)을 넘지 않도록 폭 800px, JPEG 품질 0.7로 압축한다.
function compressImageToDataUrl(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽는 데 실패했습니다."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("이미지를 불러오는 데 실패했습니다."));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- 목록 조회 (실시간) ----
function listenItems() {
  _db
    .collection("items")
    .orderBy("createdAt", "desc")
    .onSnapshot((snapshot) => {
      allItems = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderItemGrid();
    });
}

function renderItemGrid() {
  const grid = document.getElementById("item-grid");
  const keyword = document.getElementById("search-input").value.trim();
  const category = document.getElementById("category-filter").value;

  const filtered = allItems.filter((item) => {
    const matchesKeyword = !keyword || `${item.title} ${item.place}`.includes(keyword);
    const matchesCategory = !category || item.category === category;
    return matchesKeyword && matchesCategory;
  });

  grid.innerHTML = "";
  if (filtered.length === 0) {
    grid.innerHTML = '<p class="empty-state">등록된 분실물이 없습니다.</p>';
    return;
  }

  filtered.forEach((item) => {
    const card = document.createElement("article");
    card.className = "item-card";
    card.dataset.status = item.status;
    card.innerHTML = `
      <img src="${item.photoUrl}" alt="${item.title}" class="item-photo" />
      <div class="item-body">
        <span class="status-tag status-${item.status}">${STATE_LABELS[item.status]}</span>
        <h3>${item.title}</h3>
        <p class="item-place">${item.place} · ${formatDate(item.foundAt)}</p>
      </div>
    `;
    card.addEventListener("click", () => openItemModal(item));
    grid.appendChild(card);
  });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function setupSearchFilter() {
  document.getElementById("search-input").addEventListener("input", renderItemGrid);
  document.getElementById("category-filter").addEventListener("change", renderItemGrid);
}

// ---- 분실물 등록 ----
function setupRegisterForm() {
  const form = document.getElementById("register-form");

  document.getElementById("add-private-feature").addEventListener("click", () => {
    const list = document.getElementById("private-feature-list");
    const input = document.createElement("input");
    input.type = "text";
    input.name = "privateFeature";
    input.placeholder = "예: 가방 안쪽 주머니에 메모가 들어있음";
    list.appendChild(input);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const privateFeatures = formData
      .getAll("privateFeature")
      .map((v) => v.trim())
      .filter(Boolean);

    if (privateFeatures.length < 2) {
      alert("도난 방지를 위해 사진에 나오지 않는 특징을 2개 이상 입력해주세요.");
      return;
    }

    const photoFile = formData.get("photo");
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "등록 중...";

    try {
      const photoUrl = await compressImageToDataUrl(photoFile);
      if (photoUrl.length > 700000) {
        alert("사진 용량이 너무 큽니다. 더 작은 사진으로 다시 시도해주세요.");
        submitBtn.disabled = false;
        submitBtn.textContent = "등록하기";
        return;
      }

      const itemRef = await _db.collection("items").add({
        title: formData.get("title"),
        category: formData.get("category"),
        place: formData.get("place"),
        foundAt: formData.get("foundAt"),
        publicNote: formData.get("publicNote") || "",
        photoUrl,
        status: ITEM_STATES.REGISTERED,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      // 비공개 특징은 별도 하위 문서에 저장한다.
      // firestore.rules에서 이 경로는 관리자만 읽을 수 있도록 막혀 있다.
      await _db.collection("items").doc(itemRef.id).collection("private").doc("data").set({
        features: privateFeatures,
      });

      alert("분실물이 등록되었습니다.");
      form.reset();
      document.querySelector('.tab-btn[data-tab="list"]').click();
    } catch (err) {
      console.error(err);
      alert("등록 중 오류가 발생했습니다: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "등록하기";
    }
  });
}

// ---- 분실물 상세 ----
function openItemModal(item) {
  const modal = document.getElementById("item-modal");
  modal.querySelector(".modal-body").innerHTML = `
    <img src="${item.photoUrl}" alt="${item.title}" />
    <h2>${item.title}</h2>
    <p>${item.place} · ${formatDate(item.foundAt)}</p>
    <p>${item.publicNote || ""}</p>
    <span class="status-tag status-${item.status}">${STATE_LABELS[item.status]}</span>
    <div class="modal-actions"></div>
  `;
  const actions = modal.querySelector(".modal-actions");

  if (item.status === ITEM_STATES.REGISTERED) {
    const claimBtn = document.createElement("button");
    claimBtn.textContent = "내 분실물이에요";
    claimBtn.className = "primary-btn";
    claimBtn.addEventListener("click", () => openClaimModal(item));
    actions.appendChild(claimBtn);
  } else if (item.status === ITEM_STATES.CLAIMED) {
    if (getMyClaim(item.id)) {
      const confirmBtn = document.createElement("button");
      confirmBtn.textContent = "물건을 찾으러 간다고 알리기";
      confirmBtn.className = "primary-btn";
      confirmBtn.addEventListener("click", () => confirmPickup(item));
      actions.appendChild(confirmBtn);
    } else {
      actions.innerHTML = '<p class="hint">이미 다른 학생이 신고 절차를 진행 중입니다.</p>';
    }
  } else if (item.status === ITEM_STATES.VERIFYING) {
    actions.innerHTML = '<p class="hint">관리자 확인 후 인계가 완료됩니다.</p>';
  } else {
    actions.innerHTML = '<p class="hint">이미 주인에게 전달된 물건입니다.</p>';
  }

  modal.hidden = false;
}

// ---- 신고(내 분실물이에요) ----
function openClaimModal(item) {
  document.getElementById("item-modal").hidden = true;
  const modal = document.getElementById("claim-modal");
  modal.querySelector(".modal-body").innerHTML = `
    <h2>내 분실물 신고</h2>
    <p class="hint">도난 방지를 위해 이름/학년과, 사진으로는 알 수 없는 물건의 특징을 함께 적어주세요. 관리자가 습득자가 등록한 정보와 대조합니다.</p>
    <form id="claim-form">
      <label>이름<input name="name" required /></label>
      <label>학년/반<input name="grade" required placeholder="예: 2학년 3반" /></label>
      <label>이 물건의 특징(사진에 없는 정보)<textarea name="guess" required placeholder="예: 케이스 안쪽에 스티커가 붙어있어요"></textarea></label>
      <button type="submit" class="primary-btn">신고하기</button>
    </form>
  `;
  modal.querySelector("#claim-form").addEventListener("submit", (e) => submitClaim(e, item));
  modal.hidden = false;
}

async function submitClaim(e, item) {
  e.preventDefault();
  const formData = new FormData(e.target);

  try {
    const claimRef = await _db.collection("items").doc(item.id).collection("claims").add({
      name: formData.get("name"),
      grade: formData.get("grade"),
      guess: formData.get("guess"),
      status: "PENDING",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    await _db.collection("items").doc(item.id).update({
      status: nextState(item.status, ITEM_STATES.CLAIMED),
    });

    saveMyClaim(item.id, claimRef.id);
    alert("신고가 접수되었습니다. 관리자 확인 후 안내해 드려요.");
    document.getElementById("claim-modal").hidden = true;
  } catch (err) {
    console.error(err);
    alert("신고 중 오류가 발생했습니다: " + err.message);
  }
}

async function confirmPickup(item) {
  try {
    await _db.collection("items").doc(item.id).update({
      status: nextState(item.status, ITEM_STATES.VERIFYING),
    });
    document.getElementById("item-modal").hidden = true;
  } catch (err) {
    console.error(err);
    alert("처리 중 오류가 발생했습니다: " + err.message);
  }
}

// 같은 기기에서 "내가 신고한 항목"을 기억해, 본인만 찾으러 간다는
// 확인을 보낼 수 있도록 하는 간단한 수준의 식별 장치.
// (완전한 본인 인증은 아니며, 최종 검증은 관리자 승인 단계에서 이루어진다.)
function saveMyClaim(itemId, claimId) {
  const store = JSON.parse(localStorage.getItem("myClaims") || "{}");
  store[itemId] = claimId;
  localStorage.setItem("myClaims", JSON.stringify(store));
}

function getMyClaim(itemId) {
  const store = JSON.parse(localStorage.getItem("myClaims") || "{}");
  return store[itemId];
}
