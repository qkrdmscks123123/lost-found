# 학교 분실물 통합 관리 웹 서비스

학년별 카카오톡 단체방에 흩어져 있던 분실물 정보를 하나의 웹 목록으로 통합하고,
도난·오인 수령을 막기 위한 공개/비공개 특징 대조 검증과 관리자 승인 절차를 갖춘
분실물 관리 서비스입니다.

## 폴더 구조

```
lost-and-found-app/
├── index.html          화면 전체 구조
├── css/style.css        디자인
├── js/
│   ├── firebase-config.js  Firebase 프로젝트 설정값 (직접 채워야 함)
│   ├── fsm.js               인계 절차를 정의한 유한 상태 기계
│   ├── main.js               앱 초기화, 탭 전환
│   ├── student.js            학생 화면: 목록, 등록, 신고
│   └── admin.js               관리자 화면: 로그인, 대조, 승인
├── firestore.rules      Firestore 보안 규칙
└── storage.rules         Storage(사진) 보안 규칙
```

> 사진은 Firebase Storage에 올리고, Firestore에는 사진 주소(URL)만 저장합니다.
> Storage는 Blaze(종량제) 요금제로 업그레이드해야 사용할 수 있습니다.
>
> 또한 Firebase SDK를 모듈(module) 방식이 아닌 일반 `<script>` 태그(compat 버전)로
> 불러오도록 구성했습니다. 그래서 `index.html`을 로컬 서버 없이 더블클릭만 해도 바로 열립니다.

## 1단계 — Firebase 프로젝트 만들기

1. [Firebase 콘솔](https://console.firebase.google.com)에서 새 프로젝트를 만듭니다.
2. 왼쪽 메뉴에서 **Authentication**을 열고 "로그인 방법"에서 **이메일/비밀번호**와
   **익명**(Anonymous) 두 가지를 모두 사용 설정합니다.
   - 이메일/비밀번호: 관리자 로그인용
   - 익명: 일반 학생이 접속하면 자동으로 로그인되어, 완전한 비로그인 쓰기보다
     한 단계 안전하게 만들어 줍니다.
3. **Firestore Database**를 만듭니다. (프로덕션 모드로 시작해도 되며, 규칙은 2단계에서 덮어씁니다.)
4. **Storage**를 만듭니다. (Blaze 요금제 업그레이드 필요, 사진 저장용)
5. 프로젝트 설정 > 일반 탭에서 "웹 앱 추가"를 눌러 나오는 설정값을
   `js/firebase-config.js`에 그대로 붙여넣습니다.

## 2단계 — 보안 규칙 배포

Firebase CLI를 쓸 수 있다면:

```bash
npm install -g firebase-tools
firebase login
firebase init firestore storage   # 기존 firestore.rules / storage.rules 사용 선택
firebase deploy --only firestore:rules,storage
```

CLI 설치가 어렵다면 Firebase 콘솔의 Firestore Database > 규칙 탭, Storage > 규칙 탭에
`firestore.rules`, `storage.rules` 내용을 각각 복사해 붙여넣고 "게시"를 누르면 됩니다.

## 3단계 — 관리자 계정 등록

1. Firebase 콘솔 Authentication에서 이메일/비밀번호로 관리자 계정을 하나 만듭니다.
2. 그 계정의 UID를 복사합니다(Authentication 사용자 목록에서 확인 가능).
3. Firestore Database에서 `admins`라는 컬렉션을 만들고, 문서 ID를 방금 복사한 UID로 해서
   빈 문서(필드 없이) 하나를 추가합니다. 이 문서가 존재하는 계정만 관리자로 인식됩니다.

## 4단계 — 로컬에서 실행하기

`index.html`을 더블클릭하면 바로 브라우저에서 열립니다. 파이썬이나 Node.js 같은
로컬 서버 설치가 필요 없습니다.

## 5단계 — 실제 서비스로 배포하기

Firebase Hosting으로 무료 배포할 수 있습니다.

```bash
firebase init hosting   # public 디렉터리를 lost-and-found-app으로 지정
firebase deploy --only hosting
```

배포가 끝나면 `https://프로젝트이름.web.app` 같은 주소가 생성되어,
학생들이 각자 스마트폰/PC에서 접속할 수 있습니다.

## 인계 절차 (유한 상태 기계)

`js/fsm.js`에 아래 네 가지 상태와 전이 규칙이 정의되어 있고,
같은 규칙이 `firestore.rules`에도 한 번 더 구현되어 있어 서버 단에서도 강제됩니다.

```
등록됨(REGISTERED)
   └─ 학생이 "내 분실물이에요" 신고 → 신고접수(CLAIMED)
신고접수(CLAIMED)
   └─ 신고자가 찾으러 간다고 알림 → 확인중(VERIFYING)
확인중(VERIFYING)
   └─ 관리자가 정보 대조 후 승인 → 인계완료(COMPLETED)   ← 관리자만 호출 가능
```

## 도난 방지 설계

- 습득자는 등록 시 물건의 특징을 **공개 특징**(사진에 보이는 정보)과
  **비공개 특징**(사진으로는 알 수 없는 정보, 최소 2개)으로 나눠 입력합니다.
- 비공개 특징은 `items/{itemId}/private/data` 경로에 별도로 저장되며,
  `firestore.rules`에서 관리자만 읽을 수 있도록 제한되어 있습니다.
- 신고자는 자신이 기억하는 물건의 특징을 함께 제출하고, 관리자는 이를
  비공개 특징과 대조해 실제 소유자인지 판단한 뒤에만 최종 승인(COMPLETED)을 누를 수 있습니다.

## 알려진 한계 (추후 개선 아이디어)

- 신고자 본인 확인은 같은 브라우저의 로컬 저장소에 의존하는 간단한 수준입니다.
  더 엄격하게 하려면 학교 계정 기반 로그인(Google Workspace 등)을 연동할 수 있습니다.
- 사진 업로드는 5MB 이하의 이미지 파일만 허용하며, 부적절한 이미지 필터링은 되어 있지 않습니다.
- 현재는 Firestore 클라이언트 SDK만으로 구현되어 있어, 더 복잡한 검증(예: 유사 이미지
  자동 비교)을 추가하려면 Cloud Functions 같은 서버 로직이 필요합니다.
