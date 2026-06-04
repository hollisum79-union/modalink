import { createClient } from "@supabase/supabase-js";
import React, { useState, useEffect } from "react";


const supabaseUrl = "https://svbvawioldgundtpogkc.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2YnZhd2lvbGRndW5kdHBvZ2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4OTAzODQsImV4cCI6MjA5NDQ2NjM4NH0.7PrmWSX-BxZTy7IImfI_ujS07dmOlrklQUm3AM0B2II";
const supabase = createClient(supabaseUrl, supabaseKey);
// ── 교번 근무 계산 (공용 함수) ──
// member, date, rotationData만 있으면 계산되는 순수 함수.
// 근무표·교번교체가 똑같이 이걸 써서 결과가 절대 어긋나지 않음.
function calcKyobunWork(member: any, date: Date, rotationData: any[]) {
  if (!member || rotationData.length === 0) return null;
  const groupName = member.work_group === "도봉" ? "도봉 41" : "대공원 114";
  const base = new Date("2026-06-01");
  base.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - base.getTime()) / 86400000);
  const pos =
    ((((member.start_position - 1 + diff) % member.schedule_total) +
      member.schedule_total) %
      member.schedule_total) +
    1;
  const row = rotationData.find(
    (r) => r.group_name === groupName && r.position === pos
  );
  return row ? { dia: row.dia_value, type: row.work_type } : null;
}
function calcHolidayFillHours(diaNo: any, shift: string, dateStr: string, diaTable: any[], holidays: string[]) {
  if (!diaNo || !diaTable || diaTable.length === 0) return { workHours: 0, nightHours: 0 };
  const date = new Date(dateStr);
  const isHol = (d: Date) => {
    const day = d.getDay();
    if (day === 0 || day === 6) return true;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return (holidays || []).includes(`${y}-${m}-${dd}`);
  };
  let dayType: string;
  if (shift === "야간") {
    const tomo = new Date(date);
    tomo.setDate(tomo.getDate() + 1);
    const th = isHol(date), mh = isHol(tomo);
    if (!th && !mh) dayType = "평평";
    else if (!th && mh) dayType = "평휴";
    else if (th && mh) dayType = "휴휴";
    else dayType = "휴평";
  } else {
    dayType = isHol(date) ? "휴일" : "평일";
  }
  const row = (diaTable || []).find(
    (r: any) => Number(r.dia_no) === Number(diaNo) && r.day_type === dayType
  );
  if (!row) return { workHours: 0, nightHours: 0 };
  return { workHours: Number(row.work_hours) || 0, nightHours: Number(row.night_hours) || 0 };
}
function computeNetPay(input: any) {
  const {
    grade, hobong, workType, checkedItems = {}, manualInputs = {},
    nightCount = 0, salaryTable = [], worktypeSettings = [],
    hfRecords = [], diaTable = [], holidays = [], dedRates = null,
    memberInfo = null, rotationData = [],
  } = input;

  const row = salaryTable.find((r: any) => r.hobong === hobong);
  const basicSalary = row ? (row[`grade_${grade}`] ?? null) : null;
  if (!basicSalary) return null;

  const longService = hobong >= 25 ? 130000 : hobong >= 20 ? 110000 : hobong >= 15 ? 80000 : hobong >= 10 ? 60000 : hobong >= 5 ? 50000 : 0;
  const gradeSupport = (grade === 6 || grade === 7) ? 30000 : 0;
  const wtRates: Record<string, number> = {
    통상: 0.1, 변형통상: 0.108, 변형근무: 0.087,
    "4조2교대(비심야)": 0.0675, "4조2교대(심야)": 0.0635,
    "4조2교대(야간집중)": 0.06, 교번: 0.087,
  };
  const workTypePay = (basicSalary && workType) ? Math.round(basicSalary * (wtRates[workType] ?? 0)) : 0;

  const allowanceAmount = (item: string): number => {
    if (!checkedItems[item]) return 0;
    if (item === "업무보전수당") return workTypePay;
    if (item === "장기근속수당") return longService;
    if (item === "직급보조비") return gradeSupport;
    return manualInputs[item] ?? 0;
  };
  const totalAllowance = Object.keys(checkedItems).reduce((s, item) => s + allowanceAmount(item), 0);

  const tongsangWage = (basicSalary ?? 0) + totalAllowance;
  const hourlyWage = tongsangWage > 0 ? tongsangWage / 209 : 0;

  const isKyobun = memberInfo?.work_type === "교번" && (memberInfo?.work_group === "대공원" || memberInfo?.work_group === "도봉");
  let kyobunNightHours = 0;
  if (isKyobun && rotationData.length > 0 && diaTable.length > 0) {
    const n = new Date();
    const lp = new Date(new Date(n.getFullYear(), n.getMonth(), 1).getTime() - 86400000);
    const yy = lp.getFullYear(); const mn = lp.getMonth();
    const dcount = new Date(yy, mn + 1, 0).getDate();
    for (let i = 1; i <= dcount; i++) {
      const w = calcKyobunWork(memberInfo, new Date(yy, mn, i), rotationData);
      if (w && Number(w.dia) >= 60) {
        const ds = `${yy}-${String(mn + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
        kyobunNightHours += calcHolidayFillHours(w.dia, "야간", ds, diaTable, holidays).nightHours;
      }
    }
  }
  const nightHoursPerShift = worktypeSettings.find((w: any) => w.work_type === workType)?.night_hours || 0;
  const nightTotalHours = isKyobun ? kyobunNightHours : nightHoursPerShift * nightCount;
  const nightPay = Math.round(hourlyWage * 0.5 * nightTotalHours);

  let hfPaySum = 0;
  hfRecords.forEach((rec: any) => {
    const m = (rec.memo || "").match(/다이아\s*(\d+)/);
    if (!m) return;
    const { workHours, nightHours } = calcHolidayFillHours(m[1], rec.work_shift, rec.work_date, diaTable, holidays);
    if (workHours <= 0) return;
    const within8 = Math.min(workHours, 8);
    const over8 = Math.max(workHours - 8, 0);
    hfPaySum += hourlyWage * (within8 * 1.5 + over8 * 2.0) + hourlyWage * 0.5 * nightHours;
  });
  const holidayFillPay = Math.round(hfPaySum);

  const totalGross = tongsangWage + nightPay + holidayFillPay;

  const r = dedRates || {};
  const nationalPension = Math.round(tongsangWage * (r.national_pension ?? 0.045));
  const healthInsurance = Math.round(tongsangWage * (r.health_insurance ?? 0.03545));
  const longTermCare = Math.round(healthInsurance * (r.long_term_care ?? 0.1295));
  const employmentInsurance = Math.round(tongsangWage * (r.employment_insurance ?? 0.009));
  const incomeTax = Math.round(totalGross * (r.income_tax ?? 0.02));
  const localTax = Math.round(incomeTax * (r.local_tax ?? 0.1));
  const unionFee = Math.round((basicSalary ?? 0) * (r.union_fee ?? 0.012));
  const totalDeduction = nationalPension + healthInsurance + longTermCare + employmentInsurance + incomeTax + localTax + unionFee;

  return { netPay: totalGross - totalDeduction, totalGross, totalDeduction, tongsangWage };
}
function getTodayWorkInfo(member: any, rotationData: any[], diaTable: any[], holidays: string[], date = new Date()) {
  const work = calcKyobunWork(member, date, rotationData);
  if (!work) return null;

  const isHol = (d: Date) => {
    const day = d.getDay();
    if (day === 0 || day === 6) return true;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return (holidays || []).includes(`${y}-${m}-${dd}`);
  };

  let dayType: string | null = null;
  const tomo = new Date(date);
  tomo.setDate(tomo.getDate() + 1);
  const th = isHol(date), mh = isHol(tomo);
  if (work.type === "주간") dayType = th ? "휴일" : "평일";
  else if (work.type === "야간") {
    if (!th && !mh) dayType = "평평";
    else if (!th && mh) dayType = "평휴";
    else if (th && mh) dayType = "휴휴";
    else dayType = "휴평";
  }

  const diaRow = dayType
    ? (diaTable || []).find(
        (r: any) => Number(r.dia_no) === Number(work.dia) && r.day_type === dayType
      )
    : null;

  return { type: work.type, dia: work.dia, diaRow };
}
const EMBLEM =
  "data:image/jpeg;base64,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";

// 엠블럼 컴포넌트 - 이미지 로드 실패 시 SVG 대체
function EmblemImg({ style }: any) {
  const [err, setErr] = React.useState(false);
  if (err) {
    return (
      <div
        style={{
          ...style,
          background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="60%"
          height="60%"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="1.5"
        >
          <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      </div>
    );
  }
  return (
    <img src={EMBLEM} alt="엠블럼" style={style} onError={() => setErr(true)} />
  );
}

const menus = [
  {
    id: "notice",
    label: "공지사항",
    sub: "새로운 소식 확인하기",
    icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
  },
  {
    id: "schedule",
    label: "근무표",
    sub: "이번 달 근무 확인",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    id: "agreement",
    label: "합의서 및 규정",
    sub: "협약·규정 열람하기",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    id: "canteen",
    label: "식당메뉴",
    sub: "오늘의 메뉴 확인",
    icon: "M6 2v6a2 2 0 002 2v12M6 2C6 2 5 4 5 7s1 3 1 3M18 2v20M14 2v6a2 2 0 002 2",
  },
  {
    id: "archive",
    label: "자료실",
    sub: "합의서·사규",
    icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  },
  {
    id: "vote",
    label: "설문·투표",
    sub: "참여하고 의견 전달",
    icon: "M3 10h18M3 10V6a2 2 0 012-2h14a2 2 0 012 2v4M3 10l2 10h14l2-10M10 6V4m4 2V4M12 14v2m0 0h-2m2 0h2",
  },
  {
    id: "board",
    label: "자유게시판",
    sub: "조합원과 소통하기",
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  },
  {
    id: "welfare",
    label: "복지혜택",
    sub: "복지 제도 안내",
    icon: "M20 12v10H4V12M22 7H2v5h20V7zM12 22V7M12 7a2 2 0 01-2-2c0-1.5 2-4 2-4s2 2.5 2 4a2 2 0 01-2 2z",
  },
  {
    id: "inquiry",
    label: "문의하기",
    sub: "1:1 문의 및 요청",
    icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
];

const dummyNotices = [
  {
    id: 1,
    tag: "긴급",
    tagColor: "#EF4444",
    tagBg: "#FEE2E2",
    is_urgent: true,
    title: "5월 노사협의 결과 안내",
    date: "2024.05.19",
    content: "5월 노사협의 결과를 아래와 같이 안내드립니다.",
  },
  {
    id: 2,
    tag: "공지",
    tagColor: "#4F46E5",
    tagBg: "#EEF0FF",
    is_urgent: false,
    title: "2024년 단체교섭 일정 안내",
    date: "2024.05.17",
    content: "2024년 단체교섭 일정을 아래와 같이 안내드립니다.",
  },
  {
    id: 3,
    tag: "공지",
    tagColor: "#4F46E5",
    tagBg: "#EEF0FF",
    is_urgent: false,
    title: "근무표 변경 안내 (5/20~5/26)",
    date: "2024.05.16",
    content: "5월 20일부터 26일까지 근무표가 변경되었습니다.",
  },
  {
    id: 4,
    tag: "공지",
    tagColor: "#4F46E5",
    tagBg: "#EEF0FF",
    is_urgent: false,
    title: "조합원 총회 개최 안내",
    date: "2024.05.14",
    content: "2024년 상반기 조합원 총회를 개최합니다.",
  },
  {
    id: 5,
    tag: "공지",
    tagColor: "#4F46E5",
    tagBg: "#EEF0FF",
    is_urgent: false,
    title: "복지 포인트 지급 안내",
    date: "2024.05.10",
    content: "2024년 상반기 복지 포인트가 지급되었습니다.",
  },
];

const dummyPosts = [
  {
    id: 1,
    author: "김철수",
    title: "오늘 점심 진짜 맛있었어요 😋",
    content:
      "대공원 사업소 오늘 돼지불고기 진짜 맛있었습니다. 자주 나왔으면 좋겠네요!",
    date: "2024.05.19",
    views: 42,
    comments: [
      {
        id: 1,
        author: "이영희",
        content: "저도 맛있게 먹었어요!",
        date: "2024.05.19",
      },
      {
        id: 2,
        author: "박민준",
        content: "완전 동감입니다 ㅎㅎ",
        date: "2024.05.19",
      },
    ],
  },
  {
    id: 2,
    author: "이영희",
    title: "교대 근무 패턴 관련 건의사항",
    content:
      "이번 달 교대 패턴이 조금 무리가 있는 것 같아서 건의드립니다. 다들 어떻게 생각하시나요?",
    date: "2024.05.18",
    views: 87,
    comments: [
      {
        id: 1,
        author: "홍길동",
        content: "저도 힘들었어요. 건의 잘 하셨습니다.",
        date: "2024.05.18",
      },
    ],
  },
  {
    id: 3,
    author: "박민준",
    title: "노조 활동 응원합니다! 💪",
    content:
      "지회장님 이하 집행부 여러분 항상 수고 많으십니다. 덕분에 근무 환경이 좋아지고 있어요.",
    date: "2024.05.17",
    views: 63,
    comments: [],
  },
  {
    id: 4,
    author: "홍길동",
    title: "복지 포인트 사용처 추천해주세요",
    content:
      "이번에 복지 포인트 받았는데 어디서 사용하면 좋을지 추천 부탁드립니다!",
    date: "2024.05.16",
    views: 35,
    comments: [
      {
        id: 1,
        author: "김철수",
        content: "저는 마트에서 썼어요!",
        date: "2024.05.16",
      },
    ],
  },
  {
    id: 5,
    author: "최지훈",
    title: "신풍 사업소 엘리베이터 고장 관련",
    content: "신풍 사업소 엘리베이터가 자주 고장나는데 빨리 수리됐으면 합니다.",
    date: "2024.05.15",
    views: 29,
    comments: [],
  },
];

const dummyCanteen = {
  대공원: {
    아침: {
      time: "07:00 ~ 09:00",
      items: [
        { category: "주식", name: "쌀밥 / 잡곡밥" },
        { category: "국", name: "된장찌개" },
        { category: "주찬", name: "계란후라이" },
        { category: "부찬", name: "깍두기, 배추김치" },
        { category: "후식", name: "요거트" },
      ],
    },
    점심: {
      time: "11:30 ~ 13:30",
      items: [
        { category: "주식", name: "쌀밥 / 잡곡밥" },
        { category: "국", name: "육개장" },
        { category: "주찬", name: "돼지불고기" },
        { category: "부찬", name: "시금치나물, 콩자반, 깍두기" },
        { category: "후식", name: "과일 (사과)" },
      ],
    },
    저녁: {
      time: "17:00 ~ 19:00",
      items: [
        { category: "주식", name: "쌀밥 / 잡곡밥" },
        { category: "국", name: "미역국" },
        { category: "주찬", name: "생선까스" },
        { category: "부찬", name: "감자조림, 배추김치" },
        { category: "후식", name: "아이스크림" },
      ],
    },
  },
  도봉: {
    아침: {
      time: "07:00 ~ 09:00",
      items: [
        { category: "주식", name: "쌀밥 / 현미밥" },
        { category: "국", name: "콩나물국" },
        { category: "주찬", name: "햄구이" },
        { category: "부찬", name: "총각김치, 무생채" },
        { category: "후식", name: "우유" },
      ],
    },
    점심: {
      time: "11:30 ~ 13:30",
      items: [
        { category: "주식", name: "쌀밥 / 현미밥" },
        { category: "국", name: "순두부찌개" },
        { category: "주찬", name: "닭갈비" },
        { category: "부찬", name: "고사리나물, 깍두기, 배추김치" },
        { category: "후식", name: "과일 (귤)" },
      ],
    },
    저녁: {
      time: "17:00 ~ 19:00",
      items: [
        { category: "주식", name: "쌀밥 / 현미밥" },
        { category: "국", name: "부대찌개" },
        { category: "주찬", name: "고등어구이" },
        { category: "부찬", name: "도라지무침, 배추김치" },
        { category: "후식", name: "빙과" },
      ],
    },
  },
  신풍: {
    아침: {
      time: "07:00 ~ 09:00",
      items: [
        { category: "주식", name: "쌀밥 / 보리밥" },
        { category: "국", name: "시금치된장국" },
        { category: "주찬", name: "두부조림" },
        { category: "부찬", name: "배추김치, 열무김치" },
        { category: "후식", name: "두유" },
      ],
    },
    점심: {
      time: "11:30 ~ 13:30",
      items: [
        { category: "주식", name: "쌀밥 / 보리밥" },
        { category: "국", name: "김치찌개" },
        { category: "주찬", name: "제육볶음" },
        { category: "부찬", name: "숙주나물, 장조림, 깍두기" },
        { category: "후식", name: "과일 (바나나)" },
      ],
    },
    저녁: {
      time: "17:00 ~ 19:00",
      items: [
        { category: "주식", name: "쌀밥 / 보리밥" },
        { category: "국", name: "북어국" },
        { category: "주찬", name: "돈까스" },
        { category: "부찬", name: "브로콜리무침, 배추김치" },
        { category: "후식", name: "요거트" },
      ],
    },
  },
};

// ── 호봉 자동산정 함수 ──
// ── 임시 비밀번호 생성 함수 ──
function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pw = "";
  for (let i = 0; i < 6; i++)
    pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

// ── 호봉 자동산정 함수 ──
// 서울교통공사: 입사 첫날 1호봉, 입사월 다음달 1일자로 호봉 승급
// 예) 2007.04.05 입사 → 2008.05.01 = 2호봉, 2009.05.01 = 3호봉
function calcPayStep(joinDateStr) {
  if (!joinDateStr || joinDateStr.length !== 8)
    return { payStep: 1, years: 0, months: 0 };
  const y = parseInt(joinDateStr.slice(0, 4));
  const m = parseInt(joinDateStr.slice(4, 6)) - 1; // 0-based
  const d = parseInt(joinDateStr.slice(6, 8));
  if (isNaN(y) || isNaN(m) || isNaN(d))
    return { payStep: 1, years: 0, months: 0 };
  const joinDate = new Date(y, m, d);
  const now = new Date();
  if (isNaN(joinDate.getTime()) || joinDate > now)
    return { payStep: 1, years: 0, months: 0 };

  // 첫 승급일: 입사월 다음달 1일 (매년 동일 월/일 반복)
  // 입사 즉시 1호봉, 첫 승급일에 2호봉
  const firstPromoMonth = m + 1; // 입사월 다음달 (0-based)
  const firstPromoYear = firstPromoMonth > 11 ? y + 1 : y;
  const firstPromoMonthAdj = firstPromoMonth > 11 ? 0 : firstPromoMonth;
  const firstPromoDate = new Date(firstPromoYear, firstPromoMonthAdj, 1);

  if (now < firstPromoDate) {
    // 첫 승급 전: 1호봉
    const months = Math.floor(
      (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    return { payStep: 1, years: 0, months: Math.min(months, 11) };
  }

  // 첫 승급 후: 매년 firstPromoMonthAdj월 1일 승급
  let years = now.getFullYear() - firstPromoYear;
  const thisYearPromo = new Date(now.getFullYear(), firstPromoMonthAdj, 1);
  if (now < thisYearPromo) years--;
  if (years < 0) years = 0;

  const rawPayStep = years + 2; // 첫 승급 시 2호봉 + 이후 매년 +1
  const payStep = Math.min(rawPayStep, 40); // 최고 40호봉 상한
  const remainMonths =
    now.getMonth() - firstPromoMonthAdj + (now < thisYearPromo ? 12 : 0);
  return { payStep, years: years + 1, months: remainMonths % 12 };
}

// ── 호봉 승급일 계산 함수 ──
// 다음 승급일 반환 (입사월 다음달 1일 기준)
function getNextPromoDate(joinDateStr) {
  if (!joinDateStr || joinDateStr.length !== 8) return null;
  const y = parseInt(joinDateStr.slice(0, 4));
  const m = parseInt(joinDateStr.slice(4, 6)) - 1;
  const d = parseInt(joinDateStr.slice(6, 8));
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;

  const promoMonth = (m + 1) % 12; // 다음달 (0-based)
  const now = new Date();
  let promoYear = now.getFullYear();

  // 올해 승급일
  let nextPromo = new Date(promoYear, promoMonth, 1);
  // 이미 지났으면 내년
  if (nextPromo <= now) {
    promoYear++;
    nextPromo = new Date(promoYear, promoMonth, 1);
  }
  return nextPromo;
}

// ── 호봉 승급 알림 체크 ──
// 승급일 5일 전이면 알림 반환
function checkPromoAlert(joinDateStr, addPayStep = 0) {
  if (!joinDateStr || joinDateStr.length !== 8) return null;
  const current = calcPayStep(joinDateStr);
  const currentTotal = current.payStep + addPayStep;
  // 이미 40호봉 달성 시 알림 없음
  if (currentTotal >= 40) return null;
  const nextPromo = getNextPromoDate(joinDateStr);
  if (!nextPromo) return null;
  const now = new Date();
  const diffMs = nextPromo.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysLeft > 5 || daysLeft < 0) return null;
  const nextPayStep = Math.min(current.payStep + 1 + addPayStep, 40);
  const isMax = nextPayStep >= 40;
  const promoDate = `${nextPromo.getFullYear()}.${String(
    nextPromo.getMonth() + 1
  ).padStart(2, "0")}.${String(nextPromo.getDate()).padStart(2, "0")}`;
  return { show: true, daysLeft, nextPayStep, promoDate, isMax };
}

function Icon({ path, size = 24, color = "#4F46E5", strokeWidth = 1.5 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

// ── 자유게시판 글쓰기 ──
function BoardWrite({ onBack, onSubmit, user }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("자유");

  const categories = [
    { name: "자유", color: "#4F46E5", bg: "#EEF0FF" },
    { name: "경조사", color: "#EF4444", bg: "#FEE2E2" },
    { name: "삽니다", color: "#10B981", bg: "#D1FAE5" },
    { name: "팝니다", color: "#F59E0B", bg: "#FEF3C7" },
  ];

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return;
    onSubmit({ title, content, category });
  };

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "56px 20px 16px",
          background: "#fff",
          borderBottom: "1px solid #F3F4F6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#1F2937" size={24} />
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>
            글쓰기
          </span>
        </div>
        <button
          onClick={handleSubmit}
          style={{
            background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          등록
        </button>
      </div>
      <div style={{ padding: "20px 16px" }}>
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            boxShadow: "0 2px 12px rgba(79,70,229,0.06)",
          }}
        >
          <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 16 }}>
            작성자: <strong style={{ color: "#4F46E5" }}>{user?.name}</strong>
          </div>
          <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 8 }}>
            카테고리
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            {categories.map((c) => (
              <button
                key={c.name}
                onClick={() => setCategory(c.name)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 10,
                  border:
                    category === c.name
                      ? `1.5px solid ${c.color}`
                      : "1.5px solid #E5E7EB",
                  background: category === c.name ? c.bg : "#fff",
                  color: category === c.name ? c.color : "#9CA3AF",
                  fontSize: 13,
                  fontWeight: category === c.name ? 700 : 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목을 입력하세요"
            style={{
              width: "100%",
              padding: "13px 0",
              borderRadius: 0,
              border: "none",
              borderBottom: "1.5px solid #E5E7EB",
              fontSize: 16,
              fontWeight: 600,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#1F2937",
              marginBottom: 16,
            }}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="내용을 입력하세요"
            rows={12}
            style={{
              width: "100%",
              padding: "0",
              border: "none",
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#374151",
              lineHeight: 1.8,
              resize: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── 자유게시판 상세 ──
function BoardDetail({ post, onBack, user }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  useEffect(() => {
    supabase
      .from("comments")
      .select("*")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setComments(data);
      });
  }, [post.id]);

  // ── 좋아요 기능 ──
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const myEmpId = String(user?.emp_id || user?.id || "guest");

  useEffect(() => {
    supabase
      .from("post_likes")
      .select("emp_id", { count: "exact" })
      .eq("post_id", post.id)
      .then(({ data, count }) => {
        if (count !== null) setLikeCount(count);
        if (data) setLiked(data.some((row) => row.emp_id === myEmpId));
      });
  }, [post.id]);

  const handleLike = () => {
    if (liked) {
      setLiked(false);
      setLikeCount((c) => Math.max(0, c - 1));
      supabase
        .from("post_likes")
        .delete()
        .eq("post_id", post.id)
        .eq("emp_id", myEmpId)
        .then(() => {});
    } else {
      setLiked(true);
      setLikeCount((c) => c + 1);
      supabase
        .from("post_likes")
        .insert([{ post_id: post.id, emp_id: myEmpId }])
        .then(() => {
          // 글 주인에게 좋아요 알림 (내 글에 내가 좋아요 누른 건 제외)
          if (post.author_emp && post.author_emp !== myEmpId) {
            supabase.from("notifications").insert({
              recipient_emp: post.author_emp,
              type: "like",
              post_id: String(post.id),
              post_title: post.title,
              actor_name: user?.name,
            });
          }
        });
    }
  };

  const handleComment = () => {
    if (!newComment.trim()) return;
    const payload = {
      post_id: post.id,
      author: user?.name,
      author_emp: user?.employee_number,
      content: newComment,
    };
    supabase
      .from("comments")
      .insert([payload])
      .select()
      .then(({ data }) => {
        if (data && data[0]) {
          setComments([...comments, data[0]]);
          setNewComment("");
          // 글 주인에게 알림 보내기 (내 글에 내가 댓글 단 건 제외)
          if (post.author_emp && post.author_emp !== user?.employee_number) {
            supabase.from("notifications").insert({
              recipient_emp: post.author_emp,
              type: "comment",
              post_id: String(post.id),
              post_title: post.title,
              actor_name: user?.name,
            });
          }
        }
      });
  };

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "56px 20px 16px",
          background: "#fff",
          borderBottom: "1px solid #F3F4F6",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <Icon path="M15 19l-7-7 7-7" color="#1F2937" size={24} />
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>
          자유게시판
        </span>
      </div>
      <div
        style={{ background: "#fff", padding: "24px 20px", marginBottom: 8 }}
      >
        <h2
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#1F2937",
            lineHeight: 1.4,
            marginBottom: 12,
          }}
        >
          {post.title}
        </h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#EEF0FF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              color="#4F46E5"
              size={16}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1F2937" }}>
              {post.author}
            </div>
            <div style={{ fontSize: 11, color: "#9CA3AF" }}>{post.date}</div>
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon
              path="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              color="#9CA3AF"
              size={14}
            />
            <span style={{ fontSize: 12, color: "#9CA3AF" }}>{post.views}</span>
          </div>
        </div>
        <div style={{ height: 1, background: "#F3F4F6", marginBottom: 20 }} />
        <p style={{ fontSize: 15, color: "#374151", lineHeight: 1.8 }}>
          {post.content}
        </p>
      </div>
      <div
        style={{
          background: "#fff",
          padding: "16px 20px",
          marginBottom: 8,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <button
          onClick={handleLike}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 28px",
            borderRadius: 24,
            border: liked ? "1.5px solid #EF4444" : "1.5px solid #E5E7EB",
            background: liked ? "#FEE2E2" : "#fff",
            color: liked ? "#EF4444" : "#6B7280",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 18 }}>{liked ? "❤️" : "🤍"}</span>
          좋아요 {likeCount}
        </button>
      </div>

      <div style={{ background: "#fff", padding: "20px" }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#1F2937",
            marginBottom: 16,
          }}
        >
          댓글 <span style={{ color: "#4F46E5" }}>{comments.length}</span>
        </div>

        {comments.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "24px 0",
              color: "#9CA3AF",
              fontSize: 14,
            }}
          >
            첫 댓글을 남겨보세요 😊
          </div>
        )}

        {comments.map((c) => (
          <div
            key={c.id}
            style={{ display: "flex", gap: 12, marginBottom: 16 }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#EEF0FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon
                path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                color="#4F46E5"
                size={14}
              />
            </div>
            <div
              style={{
                flex: 1,
                background: "#F8F7FF",
                borderRadius: 12,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{ fontSize: 13, fontWeight: 600, color: "#1F2937" }}
                >
                  {c.author}
                </span>
                <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                  <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                    {c.created_at?.slice(0, 10)}
                  </span>
                </span>
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: "#374151",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {c.content}
              </p>
            </div>
          </div>
        ))}
        {user ? (
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 16,
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#EEF0FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon
                path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                color="#4F46E5"
                size={14}
              />
            </div>
            <div
              style={{
                flex: 1,
                background: "#F8F7FF",
                borderRadius: 14,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="댓글을 입력하세요"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleComment();
                }}
                style={{
                  flex: 1,
                  border: "none",
                  background: "none",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: "inherit",
                  color: "#1F2937",
                }}
              />
              <button
                onClick={handleComment}
                style={{
                  background: "#4F46E5",
                  border: "none",
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <Icon
                  path="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  color="#fff"
                  size={16}
                />
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "12px",
              background: "#F8F7FF",
              borderRadius: 12,
              fontSize: 13,
              color: "#9CA3AF",
            }}
          >
            로그인 후 댓글을 작성할 수 있습니다.
          </div>
        )}
      </div>
    </div>
  );
}

// ── 자유게시판 목록 ──
function BoardList({ onBack, onSelect, onWrite, user, initialFilter = "전체" }) {
  const [posts, setPosts] = useState([]);
  const [filter, setFilter] = useState(initialFilter);

  const categoryColor = {
    자유: { color: "#4F46E5", bg: "#EEF0FF" },
    경조사: { color: "#EF4444", bg: "#FEE2E2" },
    삽니다: { color: "#10B981", bg: "#D1FAE5" },
    팝니다: { color: "#F59E0B", bg: "#FEF3C7" },
  };
  const tabs = ["전체", "자유", "경조사", "삽니다", "팝니다"];

  useEffect(() => {
    supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setPosts(data);
      });
    // 조합원이 게시판을 열면 내 알림(댓글·좋아요) 읽음 처리
    if (user?.employee_number) {
      supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("recipient_emp", user.employee_number)
        .eq("is_read", false)
        .then(() => {});
    }
    // 관리자가 게시판을 열면 모든 글을 '읽음'으로 처리 (알림 사라짐)
    if (user?.is_admin) {
      supabase
        .from("posts")
        .update({ admin_read: true })
        .eq("admin_read", false)
        .then(() => {});
    }
  }, []);

  const filteredPosts =
    filter === "전체"
      ? posts
      : posts.filter((p) => (p.category || "자유") === filter);

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onBack}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "none",
                borderRadius: "50%",
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
            </button>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
                대공원승무지회
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
                자유게시판
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.7)",
                  marginTop: 4,
                }}
              >
                서로를 존중하는 공간 ·{" "}
                <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                  우리가 만들어요 🤝
                </span>
              </div>
            </div>
          </div>
          {user && (
            <button
              onClick={onWrite}
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "1.5px solid rgba(255,255,255,0.4)",
                borderRadius: 12,
                padding: "8px 16px",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon path="M12 4v16m8-8H4" color="#fff" size={14} />
              글쓰기
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "14px 16px 6px",
          overflowX: "auto",
        }}
      >
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              padding: "7px 16px",
              borderRadius: 20,
              border: "none",
              background: filter === t ? "#4F46E5" : "#fff",
              color: filter === t ? "#fff" : "#6B7280",
              fontSize: 13,
              fontWeight: filter === t ? 700 : 500,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ background: "#fff", marginTop: 8 }}>
        {filteredPosts.length === 0 && (
          <div
            style={{
              padding: "48px 20px",
              textAlign: "center",
              color: "#9CA3AF",
              fontSize: 14,
            }}
          >
            아직 작성된 글이 없습니다
          </div>
        )}
        {filteredPosts.map((post, i) => {
          const cat = post.category || "자유";
          const cc = categoryColor[cat] || categoryColor["자유"];
          return (
            <div
              key={post.id}
              onClick={() => onSelect(post)}
              style={{
                padding: "16px 20px",
                borderBottom:
                  i < filteredPosts.length - 1 ? "1px solid #F3F4F6" : "none",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: cc.color,
                    background: cc.bg,
                    padding: "2px 8px",
                    borderRadius: 6,
                    flexShrink: 0,
                  }}
                >
                  {cat}
                </span>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#1F2937",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {post.title}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "#6B7280" }}>
                  {post.author}
                </span>
                <span style={{ fontSize: 12, color: "#D1D5DB" }}>·</span>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                  {post.created_at?.slice(0, 10)}
                </span>
                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 3 }}
                  >
                    <Icon
                      path="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      color="#9CA3AF"
                      size={13}
                    />
                    <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                      {post.views || 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 식당메뉴 ──
function toNum(d) { if (!d) return -1; const p = String(d).split("/"); return (Number(p[0]) || 0) * 100 + (Number(p[1]) || 0); }
function CanteenScreen({ onBack, user }) {
  const today = new Date();
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const dateStr = `${today.getFullYear()}년 ${
    today.getMonth() + 1
  }월 ${today.getDate()}일 (${days[today.getDay()]})`;
  const hour = today.getHours();
  const [station, setStation] = useState("대공원");
  const [menus, setMenus] = useState([]);
  useEffect(() => {
    supabase.from("canteen").select("*").eq("station", station).then((res) => setMenus(res.data || []));
  }, [station]);
  const todayKey = (today.getMonth() + 1) + "/" + today.getDate();
  const [pickedDate, setPickedDate] = useState(null);
  const [showDates, setShowDates] = useState(false);
  const allDates = Array.from(new Set(menus.map((m) => m.menu_date).filter(Boolean))).sort((a, b) => toNum(a) - toNum(b));
  const viewDate = pickedDate || todayKey;
    const isAdmin = user?.is_admin;
  const [uploading, setUploading] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const stationColor = { 대공원: "#4F46E5", 도봉: "#0EA5E9", 신풍: "#10B981" };
  const stationPrice = { 대공원: "4,000원", 도봉: "3,500원", 신풍: "3,500원" };
  const categoryColor = {
    주식: "#4F46E5",
    국: "#0EA5E9",
    주찬: "#10B981",
    부찬: "#F59E0B",
    후식: "#EC4899",
  };

  const meals = [
    {
      key: "아침",
      emoji: "🌅",
      time: "07:00 ~ 09:00",
      isCurrent: hour >= 7 && hour < 10,
    },
    {
      key: "점심",
      emoji: "☀️",
      time: "11:30 ~ 13:30",
      isCurrent: hour >= 10 && hour < 15,
    },
    { key: "저녁", emoji: "🌙", time: "17:00 ~ 19:00", isCurrent: hour >= 15 },
  ];

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 28px",
          borderRadius: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              대공원승무지회
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              식당 메뉴
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 4,
              }}
            >
              오늘도 ·{" "}
              <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                맛있는 한 끼 😋
              </span>
            </div>
          </div>
        </div>
        <div
          style={{
            background: "rgba(255,255,255,0.15)",
            borderRadius: 12,
            padding: "10px 16px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
                    <Icon
            path="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            color="#fff"
            size={16}
          />
          <span onClick={() => allDates.length > 0 && setShowDates(!showDates)} style={{ fontSize: 14, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
            {viewDate === todayKey ? dateStr : ("2026년 " + viewDate.replace("/", "월 ") + "일")}
          </span>
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 12,
              color: "#9CA3AF",
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            사업소 선택
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {["대공원", "도봉", "신풍"].map((s) => (
              <button
                key={s}
                onClick={() => setStation(s)}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  borderRadius: 14,
                  border: "2px solid",
                  borderColor: station === s ? stationColor[s] : "#E5E7EB",
                  background: station === s ? `${stationColor[s]}12` : "#fff",
                  color: station === s ? stationColor[s] : "#6B7280",
                  fontWeight: station === s ? 700 : 400,
                  fontSize: 14,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div>{s}</div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: station === s ? stationColor[s] : "#9CA3AF",
                    marginTop: 3,
                  }}
                >
                  식비 {stationPrice[s]}
                </div>
              </button>
            ))}
          </div>
        </div>
      {showDates && allDates.length > 0 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 4 }}>
            {allDates.map((d) => (
              <button key={d} onClick={() => { setPickedDate(d); setShowDates(false); }} style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 12, border: "2px solid", borderColor: viewDate === d ? "#4F46E5" : "#E5E7EB", background: viewDate === d ? "#4F46E5" : "#fff", color: viewDate === d ? "#fff" : "#6B7280", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {d}{d === todayKey ? " ·오늘" : ""}
              </button>
            ))}
          </div>
        )}
        {meals.map((meal) => {
          const menuData = dummyCanteen[station][meal.key];
          return (
            <div key={meal.key} style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: meal.isCurrent ? "#4F46E5" : "#E5E7EB",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ fontSize: 18 }}>{meal.emoji}</span>
                </div>
                <div>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: meal.isCurrent ? "#4F46E5" : "#1F2937",
                      }}
                    >
                      {meal.key}
                    </span>
                    {meal.isCurrent && (
                      <span
                        style={{
                          background: "#4F46E5",
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 6,
                          padding: "2px 8px",
                        }}
                      >
                        현재
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#9CA3AF" }}>
                    {meal.time}
                  </div>
                </div>
              </div>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  overflow: "hidden",
                  boxShadow: meal.isCurrent
                    ? "0 4px 16px rgba(79,70,229,0.12)"
                    : "0 2px 8px rgba(79,70,229,0.06)",
                  border: meal.isCurrent ? "2px solid #EEF0FF" : "none",
                }}
              >
                {(() => {
                  const sameMeal = menus.filter((m) => m.meal_type === meal.key && m.menu_date);
              const pastOrToday = sameMeal.filter((m) => toNum(m.menu_date) <= toNum(todayKey));
              const pool = pastOrToday.length ? pastOrToday : sameMeal;
              const row = pool.slice().sort((a, b) => toNum(b.menu_date) - toNum(a.menu_date))[0];
                  const list = row && row.items && row.items[0] ? String(row.items[0]).split(",").map((x) => x.trim()).filter(Boolean) : [];
                  if (list.length === 0) return (<div style={{ padding: "16px 18px", color: "#9CA3AF", fontSize: 13 }}>오늘 등록된 메뉴가 없습니다.</div>);
                  return list.map((name, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", borderBottom: i < list.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                      <span style={{ fontSize: 14, color: "#1F2937", flex: 1 }}>{name}</span>
                    </div>
                  ));
                })()}
                {false && menuData.items.map((item, i) => (

                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "13px 18px",
                      borderBottom:
                        i < menuData.items.length - 1
                          ? "1px solid #F3F4F6"
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 24,
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        background: `${categoryColor[item.category]}18`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: categoryColor[item.category],
                        }}
                      >
                        {item.category}
                      </span>
                    </div>
                    <span style={{ fontSize: 14, color: "#1F2937", flex: 1 }}>
                      {item.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div
          style={{
            background: "#EEF0FF",
            borderRadius: 12,
            padding: "12px 16px",
            fontSize: 12,
            color: "#6B7280",
            lineHeight: 1.6,
            marginBottom: 12,
          }}
        >
          💡 메뉴는 당일 식재료 수급 사정에 따라 변경될 수 있습니다.
        </div>
      </div>
    </div>
  );
}

// ── 로그인 ──
// 비밀번호 강도 검사: 영문+숫자 조합 7자 이상
function validatePassword(pw) {
  if (pw.length < 7) return "비밀번호는 7자 이상이어야 합니다.";
  if (!/[A-Za-z]/.test(pw)) return "영문자를 포함해야 합니다.";
  if (!/[0-9]/.test(pw)) return "숫자를 포함해야 합니다.";
  return null;
}

const LOGIN_FAIL_KEY = "login_fail_";
const MAX_FAIL = 5;
const LOCK_MINUTES = 30;

function LoginScreen({ onLogin, onGoRegister }) {
  const [name, setName] = useState("");
  const [empId, setEmpId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [failCount, setFailCount] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [showForgotPw, setShowForgotPw] = useState(false);
  // 비밀번호 변경 모드
  const [needChangePw, setNeedChangePw] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [newPwConfirm, setNewPwConfirm] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwChangeError, setPwChangeError] = useState("");

  const handleLogin = async () => {
    if (!name || !empId || !password) {
      setError("이름, 사번, 비밀번호를 모두 입력해주세요.");
      return;
    }

    // 잠금 체크
    const lockKey = LOGIN_FAIL_KEY + empId;
    const lockRaw = localStorage.getItem(lockKey);
    if (lockRaw) {
      const lockInfo = { ...JSON.parse(lockRaw) };
      if (lockInfo.until && Date.now() < lockInfo.until) {
        const remaining = Math.ceil((lockInfo.until - Date.now()) / 60000);
        setError(
          `로그인 ${MAX_FAIL}회 실패로 잠금되었습니다.\n${remaining}분 후 다시 시도해주세요.\n비밀번호 분실 시 1:1 문의로 재발급을 요청하세요.`
        );
        return;
      } else if (lockInfo.until && Date.now() >= lockInfo.until) {
        localStorage.removeItem(lockKey);
      }
    }

    // 관리자 계정
    if (name === "관리자" && empId === "0000" && password === "ADMIN1") {
      onLogin({
        name: "관리자",
        emp_id: "0000",
        is_admin: true,
        status: "approved",
      });
      return;
    }
    setLoading(true);
    setError("");
    // 실제 members 테이블에서 로그인 처리 (사번=employee_number 기준)
    const { data: foundMember } = await supabase
      .from("members")
      .select("*")
      .eq("employee_number", empId.trim())
      .eq("name", name.trim())
      .maybeSingle();

    const data = foundMember
      ? {
          ...foundMember,
          emp_id: foundMember.employee_number,
          // status 매핑: '대기'는 pending, 차단은 blocked, 그 외('명단'/'승인')는 로그인 허용
          status:
            foundMember.status === "대기"
              ? "pending"
              : foundMember.status === "차단"
              ? "blocked"
              : "approved",
        }
      : null;
    setLoading(false);

    if (!data) {
      setError(
        "이름 또는 사번이 올바르지 않습니다.\n조합원 명단을 확인해주세요."
      );
      return;
    }
    if (data.status === "pending") {
      setError(
        "가입 승인 대기 중입니다.\n관리자 승인 후 임시 비밀번호를 받아 로그인하세요."
      );
      return;
    }
    if (data.status === "blocked") {
      localStorage.removeItem("union_user");
      setError("계정이 차단되었습니다. 지회로 문의해주세요.");
      return;
    }
    if (!data.password) {
      setError(
        "비밀번호가 설정되지 않았습니다.\n관리자에게 임시 비밀번호 발급을 요청하세요."
      );
      return;
    }

    if (data.password !== password) {
      const curInfo = lockRaw ? { ...JSON.parse(lockRaw) } : { count: 0 };
      const newCount = (curInfo.count || 0) + 1;
      if (newCount >= MAX_FAIL) {
        const until = Date.now() + LOCK_MINUTES * 60 * 1000;
        localStorage.setItem(
          lockKey,
          JSON.stringify({ count: newCount, until })
        );
        setError(
          `비밀번호를 ${MAX_FAIL}회 틀렸습니다.\n${LOCK_MINUTES}분간 로그인이 잠깁니다.\n비밀번호 분실 시 1:1 문의로 재발급을 요청하세요.`
        );
      } else {
        localStorage.setItem(
          lockKey,
          JSON.stringify({ count: newCount, until: null })
        );
        setError(
          `비밀번호가 올바르지 않습니다. (${newCount}/${MAX_FAIL}회)\n${
            MAX_FAIL - newCount
          }회 더 실패하면 ${LOCK_MINUTES}분간 잠깁니다.`
        );
      }
      return;
    }

    // 성공 → 실패 기록 초기화
    localStorage.removeItem(lockKey);
    if (data.is_temp_password) {
      setPendingUser({ ...data });
      setNeedChangePw(true);
      return;
    }
    onLogin({ ...data });
  };

  const handleChangePw = async () => {
    setPwChangeError("");
    const pwErr = validatePassword(newPw);
    if (pwErr) {
      setPwChangeError(pwErr);
      return;
    }
    if (newPw !== newPwConfirm) {
      setPwChangeError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (newPw === pendingUser.password) {
      setPwChangeError("임시 비밀번호와 다른 비밀번호를 설정해주세요.");
      return;
    }
    setLoading(true);
    await supabase
      .from("members")
      .update({ password: newPw, is_temp_password: false })
      .eq("employee_number", pendingUser.emp_id);
    setLoading(false);
    onLogin({ ...pendingUser, password: newPw, is_temp_password: false });
  };

  // 비밀번호 변경 화면
  if (needChangePw)
    return (
      <div
        style={{
          maxWidth: 430,
          margin: "0 auto",
          fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
          background: "#F4F3FF",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          padding: "0 16px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            background:
              "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
            padding: "48px 24px 36px",
            borderRadius: 28,
            marginTop: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
            비밀번호 변경
          </div>
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.75)",
              marginTop: 6,
              textAlign: "center",
            }}
          >
            임시 비밀번호로 로그인되었습니다
            <br />새 비밀번호를 설정해주세요
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            borderRadius: 28,
            padding: "28px 24px",
            marginTop: 16,
            boxShadow: "0 4px 20px rgba(79,70,229,0.08)",
          }}
        >
          <div
            style={{
              background: "#EEF0FF",
              borderRadius: 12,
              padding: "12px 16px",
              marginBottom: 20,
              fontSize: 13,
              color: "#4F46E5",
              lineHeight: 1.6,
            }}
          >
            👤 {pendingUser?.name} 님, 처음 로그인하셨습니다.
            <br />
            보안을 위해 비밀번호를 변경해주세요.
          </div>
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 7,
              }}
            >
              새 비밀번호{" "}
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                (영문+숫자 7자 이상)
              </span>
            </div>
            <div style={{ position: "relative" }}>
              <input
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="새 비밀번호 입력"
                type={showNewPw ? "text" : "password"}
                style={{
                  width: "100%",
                  padding: "13px 44px 13px 16px",
                  borderRadius: 12,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 15,
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  color: "#1F2937",
                }}
              />
              <button
                onClick={() => setShowNewPw(!showNewPw)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#9CA3AF",
                  fontSize: 13,
                }}
              >
                {showNewPw ? "숨김" : "표시"}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 7,
              }}
            >
              새 비밀번호 확인
            </div>
            <input
              value={newPwConfirm}
              onChange={(e) => setNewPwConfirm(e.target.value)}
              placeholder="비밀번호 재입력"
              type="password"
              style={{
                width: "100%",
                padding: "13px 16px",
                borderRadius: 12,
                border: `1.5px solid ${
                  newPwConfirm && newPw !== newPwConfirm ? "#EF4444" : "#E5E7EB"
                }`,
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                color: "#1F2937",
              }}
            />
            {newPwConfirm && newPw !== newPwConfirm && (
              <div style={{ fontSize: 12, color: "#EF4444", marginTop: 4 }}>
                비밀번호가 일치하지 않습니다
              </div>
            )}
            {newPwConfirm && newPw === newPwConfirm && newPw.length >= 6 && (
              <div style={{ fontSize: 12, color: "#10B981", marginTop: 4 }}>
                ✅ 비밀번호가 일치합니다
              </div>
            )}
          </div>
          {pwChangeError && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#EF4444",
                fontSize: 13,
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 16,
              }}
            >
              {pwChangeError}
            </div>
          )}
          <button
            onClick={handleChangePw}
            disabled={loading}
            style={{
              width: "100%",
              padding: "15px",
              background: loading
                ? "#A5B4FC"
                : "linear-gradient(135deg, #4F46E5, #6D28D9)",
              color: "#fff",
              border: "none",
              borderRadius: 14,
              fontSize: 16,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {loading ? "변경 중..." : "비밀번호 변경 후 시작하기"}
          </button>
        </div>
      </div>
    );

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 16px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "48px 24px 36px",
          borderRadius: 28,
          marginTop: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <EmblemImg
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.5)",
            objectFit: "cover",
            background: "#fff",
            marginBottom: 16,
          }}
        />
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.75)",
            marginBottom: 6,
          }}
        >
          서울교통공사노동조합
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 900,
            color: "#fff",
            letterSpacing: -0.5,
          }}
        >
          대공원승무지회
        </div>
        <div
          style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 6 }}
        >
          조합원 전용 포털
        </div>
      </div>
      <div
        style={{
          background: "#fff",
          borderRadius: 28,
          padding: "28px 24px",
          marginTop: 16,
          boxShadow: "0 4px 20px rgba(79,70,229,0.08)",
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#1F2937",
            marginBottom: 24,
            textAlign: "center",
          }}
        >
          로그인
        </div>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 7,
            }}
          >
            이름
          </div>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            placeholder="이름을 입력하세요"
            style={{
              width: "100%",
              padding: "13px 16px",
              borderRadius: 12,
              border: "1.5px solid #E5E7EB",
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#1F2937",
            }}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 7,
            }}
          >
            사번
          </div>
          <input
            value={empId}
            onChange={(e) => {
              setEmpId(e.target.value);
              setError("");
            }}
            placeholder="사번을 입력하세요"
            type="number"
            style={{
              width: "100%",
              padding: "13px 16px",
              borderRadius: 12,
              border: "1.5px solid #E5E7EB",
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#1F2937",
            }}
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 7,
            }}
          >
            비밀번호
          </div>
          <div style={{ position: "relative" }}>
            <input
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder="비밀번호를 입력하세요"
              type={showPw ? "text" : "password"}
              style={{
                width: "100%",
                padding: "13px 44px 13px 16px",
                borderRadius: 12,
                border: "1.5px solid #E5E7EB",
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                color: "#1F2937",
              }}
            />
            <button
              onClick={() => setShowPw(!showPw)}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#9CA3AF",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            >
              {showPw ? "숨김" : "표시"}
            </button>
          </div>
        </div>
        <div
          style={{
            background: "#EEF0FF",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            fontSize: 12,
            color: "#4F46E5",
            lineHeight: 1.6,
          }}
        >
          🔑 최초 비밀번호는 <strong>union0000</strong> 입니다.
          <br />첫 로그인 후 비밀번호를 반드시 변경해주세요.
          <br />
          명단에 없으면 지회로 문의해주세요.
        </div>
        {/* 비밀번호 분실 안내 */}
        <button
          onClick={() => setShowForgotPw(!showForgotPw)}
          style={{
            width: "100%",
            background: "none",
            border: "none",
            color: "#9CA3AF",
            fontSize: 12,
            cursor: "pointer",
            textAlign: "center",
            marginBottom: 4,
            fontFamily: "inherit",
            textDecoration: "underline",
          }}
        >
          비밀번호를 잊으셨나요?
        </button>
        {showForgotPw && (
          <div
            style={{
              background: "#FEF3C7",
              borderRadius: 12,
              padding: "14px 16px",
              marginBottom: 12,
              fontSize: 12,
              color: "#92400E",
              lineHeight: 1.8,
            }}
          >
            🔒 비밀번호 분실 시<br />
            앱 내 1:1 문의 또는 지회 담당자에게 연락해
            <br />
            임시 비밀번호 재발급을 요청해주세요.
            <br />
            <span style={{ color: "#B45309" }}>
              ※ 본인 확인 후 재발급 가능합니다.
            </span>
          </div>
        )}
        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#EF4444",
              fontSize: 13,
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 16,
              whiteSpace: "pre-line",
            }}
          >
            {error}
          </div>
        )}
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: "100%",
            padding: "15px",
            background: loading
              ? "#A5B4FC"
              : "linear-gradient(135deg, #4F46E5, #6D28D9)",
            color: "#fff",
            border: "none",
            borderRadius: 14,
            fontSize: 16,
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "확인 중..." : "로그인"}
        </button>
      </div>
      <div
        style={{
          textAlign: "center",
          marginTop: 20,
          fontSize: 12,
          color: "#9CA3AF",
        }}
      >
        문의: 대공원승무지회
      </div>
    </div>
  );
}

// ── 가입 신청 ──
function RegisterScreen({ onBack }) {
  const [name, setName] = useState("");
  const [empId, setEmpId] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  // 조합원 명단과 대조하여 가입신청
  const handleRegister = async () => {
    if (!name.trim() || !empId.trim()) {
      setError("이름과 사번을 입력해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setNotFound(false);

    // 1. 조합원 명단 대조 (dummyMembers 또는 Supabase)
    const matched = dummyMembers.find(
      (m) => m.name === name.trim() && String(m.id) === empId.trim()
    );

    if (!matched) {
      // Supabase에서도 확인
      const { data } = await supabase
        .from("members")
        .select("*")
        .eq("name", name.trim())
        .eq("emp_id", empId.trim())
        .single();

      if (!data) {
        setLoading(false);
        setNotFound(true);
        setError(
          "조합원 명단에서 일치하는 정보를 찾을 수 없습니다.\n이름과 사번을 다시 확인해주세요."
        );
        return;
      }

      if (data.status === "pending") {
        setLoading(false);
        setError(
          "이미 가입 신청이 접수된 상태입니다. 관리자 승인을 기다려주세요."
        );
        return;
      }
      if (data.status === "approved") {
        setLoading(false);
        setError("이미 가입된 계정입니다. 로그인 화면으로 돌아가세요.");
        return;
      }

      // pending으로 상태 업데이트
      await supabase
        .from("members")
        .update({ status: "pending" })
        .eq("emp_id", empId.trim());
    } else {
      // dummyMembers에서 일치 - Supabase insert
      const { error: err } = await supabase.from("members").insert([
        {
          name: name.trim(),
          emp_id: empId.trim(),
          status: "pending",
          is_admin: false,
        },
      ]);
      if (err && !err.message.includes("duplicate")) {
        // 이미 있으면 update
        await supabase
          .from("members")
          .update({ status: "pending" })
          .eq("emp_id", empId.trim());
      }
    }

    setLoading(false);
    setDone(true);
  };

  if (done) {
    return (
      <div
        style={{
          maxWidth: 430,
          margin: "0 auto",
          fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
          background: "#F4F3FF",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "#EEF0FF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Icon
            path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            color="#4F46E5"
            size={40}
          />
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: "#1F2937",
            marginBottom: 12,
          }}
        >
          가입 신청 완료! 🎉
        </div>
        <div
          style={{
            background: "#EEF0FF",
            borderRadius: 16,
            padding: "16px 20px",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#4F46E5",
              marginBottom: 4,
            }}
          >
            {name}
          </div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>사번 {empId}</div>
        </div>
        <div
          style={{
            fontSize: 14,
            color: "#6B7280",
            textAlign: "center",
            lineHeight: 1.8,
            marginBottom: 8,
          }}
        >
          관리자에게 승인 요청이 전송되었습니다.
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#9CA3AF",
            textAlign: "center",
            marginBottom: 32,
          }}
        >
          승인 완료 후 로그인이 가능합니다 (1~2일 소요)
        </div>
        <button
          onClick={onBack}
          style={{
            padding: "14px 40px",
            background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
            color: "#fff",
            border: "none",
            borderRadius: 14,
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          로그인으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        padding: "0 16px",
        boxSizing: "border-box",
        paddingBottom: 40,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "56px 0 20px",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <Icon path="M15 19l-7-7 7-7" color="#1F2937" size={24} />
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>
          가입 신청
        </span>
      </div>

      <div
        style={{
          background: "#EEF0FF",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 16,
          fontSize: 13,
          color: "#4F46E5",
          lineHeight: 1.7,
        }}
      >
        💡 지회 조합원 명단의 이름과 사번이 일치해야 가입 신청이 가능합니다.
      </div>

      <div
        style={{
          background: "#fff",
          borderRadius: 24,
          padding: "28px 20px",
          boxShadow: "0 4px 20px rgba(79,70,229,0.08)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "#EEF0FF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 12px",
            }}
          >
            <Icon
              path="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
              color="#4F46E5"
              size={28}
            />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1F2937" }}>
            조합원 본인 확인
          </div>
          <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>
            명단 대조 후 관리자 승인 요청
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 7,
            }}
          >
            이름
          </div>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
              setNotFound(false);
            }}
            placeholder="조합원 명단의 실명을 입력하세요"
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 12,
              border: `1.5px solid ${notFound ? "#EF4444" : "#E5E7EB"}`,
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#1F2937",
            }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 7,
            }}
          >
            사번
          </div>
          <input
            value={empId}
            onChange={(e) => {
              setEmpId(e.target.value);
              setError("");
              setNotFound(false);
            }}
            placeholder="사번을 입력하세요"
            type="number"
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 12,
              border: `1.5px solid ${notFound ? "#EF4444" : "#E5E7EB"}`,
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#1F2937",
            }}
          />
        </div>

        {error && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#EF4444",
              fontSize: 13,
              borderRadius: 12,
              padding: "12px 16px",
              marginBottom: 16,
              lineHeight: 1.7,
              whiteSpace: "pre-line",
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleRegister}
          disabled={loading}
          style={{
            width: "100%",
            padding: "15px",
            background: loading
              ? "#A5B4FC"
              : "linear-gradient(135deg, #4F46E5, #6D28D9)",
            color: "#fff",
            border: "none",
            borderRadius: 14,
            fontSize: 16,
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "명단 확인 중..." : "가입 신청하기"}
        </button>

        <div
          style={{
            marginTop: 16,
            background: "#F8F7FF",
            borderRadius: 12,
            padding: "12px 16px",
            fontSize: 12,
            color: "#6B7280",
            lineHeight: 1.7,
          }}
        >
          📋 가입 신청 후 관리자가 승인하면 앱을 이용할 수 있습니다.
          <br />
          명단에 없는 경우 지회에 직접 문의해주세요.
        </div>
      </div>
    </div>
  );
}
// ── 문의하기 ──
const dummyInquiries = [
  {
    id: 1,
    author: "김철수",
    title: "근무표 관련 문의드립니다",
    content: "이번 달 근무표가 잘못 등록된 것 같습니다. 확인 부탁드립니다.",
    date: "2024.05.18",
    status: "답변완료",
    answers: [
      {
        id: 1,
        author: "관리자",
        content: "확인 후 수정해드렸습니다. 다시 확인해보세요!",
        date: "2024.05.19",
      },
    ],
  },
  {
    id: 2,
    author: "이영희",
    title: "복지혜택 신청 방법 문의",
    content: "복지포인트 신청은 어디서 하나요?",
    date: "2024.05.17",
    status: "답변완료",
    answers: [
      {
        id: 1,
        author: "홍길동",
        content: "복지혜택 메뉴에서 신청하시면 됩니다!",
        date: "2024.05.17",
      },
    ],
  },
  {
    id: 3,
    author: "박민준",
    title: "조합비 납부 확인 요청",
    content: "이번 달 조합비가 정상 납부되었는지 확인 부탁드립니다.",
    date: "2024.05.16",
    status: "대기중",
    answers: [],
  },
];

function InquiryWrite({ onBack, onSubmit, user }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return;
    onSubmit({ title, content });
  };

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "56px 20px 16px",
          background: "#fff",
          borderBottom: "1px solid #F3F4F6",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#1F2937" size={24} />
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>
            문의 작성
          </span>
        </div>
        <button
          onClick={handleSubmit}
          style={{
            background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          등록
        </button>
      </div>
      <div style={{ padding: "20px 16px" }}>
        <div
          style={{
            background: "#EEF0FF",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: "#4F46E5",
            lineHeight: 1.6,
          }}
        >
          🔒 1:1 문의는 작성자 본인과 지회 집행부(관리자)만 볼 수 있으며, 답변은
          관리자가 작성합니다.
        </div>
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            boxShadow: "0 2px 12px rgba(79,70,229,0.06)",
          }}
        >
          <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 16 }}>
            작성자: <strong style={{ color: "#4F46E5" }}>{user?.name}</strong>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="문의 제목을 입력하세요"
            style={{
              width: "100%",
              padding: "13px 0",
              border: "none",
              borderBottom: "1.5px solid #E5E7EB",
              fontSize: 16,
              fontWeight: 600,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#1F2937",
              marginBottom: 16,
            }}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="문의 내용을 자세히 입력해주세요"
            rows={10}
            style={{
              width: "100%",
              padding: "0",
              border: "none",
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#374151",
              lineHeight: 1.8,
              resize: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function InquiryDetail({ inquiry, onBack, user }) {
  const [answers, setAnswers] = useState([]);
  const [newAnswer, setNewAnswer] = useState("");

  useEffect(() => {
    supabase
      .from("inquiry_answers")
      .select("*")
      .eq("inquiry_id", inquiry.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setAnswers(data);
      });
  }, [inquiry.id]);

  const handleAnswer = () => {
    if (!newAnswer.trim()) return;
    const payload = {
      inquiry_id: inquiry.id,
      author: "관리자",
      content: newAnswer,
    };
    supabase
      .from("inquiry_answers")
      .insert([payload])
      .select()
      .then(({ data }) => {
        if (data && data[0]) {
          setAnswers([...answers, data[0]]);
          setNewAnswer("");
          supabase
            .from("inquiries")
            .update({ status: "답변완료" })
            .eq("id", inquiry.id)
            .then(() => {});
        }
      });
  };

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "56px 20px 16px",
          background: "#fff",
          borderBottom: "1px solid #F3F4F6",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <Icon path="M15 19l-7-7 7-7" color="#1F2937" size={24} />
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>
          문의 상세
        </span>
      </div>
      <div
        style={{ background: "#fff", padding: "24px 20px", marginBottom: 8 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              background: inquiry.status === "답변완료" ? "#D1FAE5" : "#FEF3C7",
              color: inquiry.status === "답변완료" ? "#10B981" : "#F59E0B",
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 6,
              padding: "3px 8px",
            }}
          >
            {inquiry.status}
          </span>
        </div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#1F2937",
            lineHeight: 1.4,
            marginBottom: 12,
          }}
        >
          {inquiry.title}
        </h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "#EEF0FF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              color="#4F46E5"
              size={14}
            />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1F2937" }}>
            {inquiry.author}
          </span>
          <span style={{ fontSize: 12, color: "#9CA3AF" }}>{inquiry.date}</span>
        </div>
        <div style={{ height: 1, background: "#F3F4F6", marginBottom: 16 }} />
        <p style={{ fontSize: 15, color: "#374151", lineHeight: 1.8 }}>
          {inquiry.content}
        </p>
      </div>
      <div style={{ background: "#fff", padding: "20px" }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#1F2937",
            marginBottom: 16,
          }}
        >
          답변 <span style={{ color: "#4F46E5" }}>{answers.length}</span>
        </div>

        {answers.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "24px 0",
              color: "#9CA3AF",
              fontSize: 14,
            }}
          >
            아직 답변이 없습니다. 첫 답변을 남겨보세요 😊
          </div>
        )}

        {answers.map((a) => (
          <div
            key={a.id}
            style={{ display: "flex", gap: 12, marginBottom: 16 }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: a.author === "관리자" ? "#4F46E5" : "#EEF0FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon
                path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                color={a.author === "관리자" ? "#fff" : "#4F46E5"}
                size={14}
              />
            </div>
            <div
              style={{
                flex: 1,
                background: a.author === "관리자" ? "#EEF0FF" : "#F8F7FF",
                borderRadius: 12,
                padding: "12px 14px",
                border: a.author === "관리자" ? "1px solid #C7D2FE" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: a.author === "관리자" ? "#4F46E5" : "#1F2937",
                  }}
                >
                  {a.author} {a.author === "관리자" && "⚙️"}
                </span>
                <span style={{ fontSize: 11, color: "#9CA3AF" }}>{a.date}</span>
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: "#374151",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {a.content}
              </p>
            </div>
          </div>
        ))}
        {user?.is_admin ? (
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 16,
              alignItems: "flex-end",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#EEF0FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon
                path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                color="#4F46E5"
                size={14}
              />
            </div>
            <div
              style={{
                flex: 1,
                background: "#F8F7FF",
                borderRadius: 14,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <input
                value={newAnswer}
                onChange={(e) => setNewAnswer(e.target.value)}
                placeholder="답변을 입력하세요"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAnswer();
                }}
                style={{
                  flex: 1,
                  border: "none",
                  background: "none",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: "inherit",
                  color: "#1F2937",
                }}
              />
              <button
                onClick={handleAnswer}
                style={{
                  background: "#4F46E5",
                  border: "none",
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <Icon
                  path="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  color="#fff"
                  size={16}
                />
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "12px",
              background: "#F8F7FF",
              borderRadius: 12,
              fontSize: 13,
              color: "#9CA3AF",
            }}
          >
            답변은 지회 집행부(관리자)가 작성합니다. 조금만 기다려 주세요 🙏
          </div>
        )}
      </div>
    </div>
  );
}

function InquiryList({ onBack, onSelect, onWrite, user }) {
  const [inquiries, setInquiries] = useState([]);
  const myEmpId = String(user?.emp_id || user?.id || "guest");
  const isAdmin = user?.is_admin;

  useEffect(() => {
    supabase
      .from("inquiries")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) {
          const visible = isAdmin
            ? data
            : data.filter((q) => q.author_emp_id === myEmpId);
          setInquiries(visible);
        }
      });
  }, []);

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
         padding: "52px 20px 24px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onBack}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "none",
                borderRadius: "50%",
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
            </button>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
                대공원승무지회
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
                1:1 문의
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.7)",
                  marginTop: 4,
                }}
              >
                {isAdmin ? "전체 문의 관리 ·" : "나만 볼 수 있어요 ·"}{" "}
                <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                  {isAdmin ? "관리자 모드 ⚙️" : "편하게 물어보세요 🔒"}
                </span>
              </div>
            </div>
          </div>
          {user && !isAdmin && (
            <button
              onClick={onWrite}
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "1.5px solid rgba(255,255,255,0.4)",
                borderRadius: 12,
                padding: "8px 16px",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon path="M12 4v16m8-8H4" color="#fff" size={14} />
              문의작성
            </button>
          )}
        </div>
      </div>

      <div style={{ background: "#fff", marginTop: 8 }}>
        {inquiries.length === 0 && (
          <div
            style={{
              padding: "48px 20px",
              textAlign: "center",
              color: "#9CA3AF",
              fontSize: 14,
            }}
          >
            {isAdmin
              ? "들어온 문의가 없습니다"
              : "아직 문의 내역이 없습니다.\n궁금한 점을 편하게 남겨보세요"}
          </div>
        )}
        {inquiries.map((inq, i) => (
          <div
            key={inq.id}
            onClick={() => onSelect(inq)}
            style={{
              padding: "16px 20px",
              borderBottom:
                i < inquiries.length - 1 ? "1px solid #F3F4F6" : "none",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  background: inq.status === "답변완료" ? "#D1FAE5" : "#FEF3C7",
                  color: inq.status === "답변완료" ? "#10B981" : "#F59E0B",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "2px 8px",
                  whiteSpace: "nowrap",
                }}
              >
                {inq.status}
              </span>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#1F2937",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {inq.title}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#6B7280" }}>
                {inq.author}
              </span>
              <span style={{ fontSize: 12, color: "#D1D5DB" }}>·</span>
              <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                {inq.created_at?.slice(0, 10)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 복지혜택 ──
const welfareData = [
  {
    category: "공사 혜택",
    color: "#0EA5E9",
    bg: "#E0F2FE",
    icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    items: [
      {
        title: "경조사 지원",
        desc: "결혼·출산·사망 등 경조사 시 경조금 지원",
        detail:
          "• 본인 결혼: 50만원\n• 자녀 결혼: 30만원\n• 출산: 첫째 30만원, 둘째 이상 50만원\n• 부모·배우자 사망: 50만원\n• 본인·자녀 사망: 100만원\n• 경조 휴가 별도 제공",
      },
      {
        title: "의료비 지원",
        desc: "본인 및 가족 의료비 실비 지원",
        detail:
          "• 본인 입원 의료비: 연 200만원 한도\n• 가족 입원 의료비: 연 100만원 한도\n• 건강검진 비용 전액 지원 (연 1회)\n• 4대 중증질환 본인부담금 추가 지원",
      },
      {
        title: "주택 지원",
        desc: "주택구입·전세자금 저금리 대출 지원",
        detail:
          "• 주택구입자금 대출: 최대 1억원 (연 1%)\n• 전세자금 대출: 최대 5천만원 (연 1%)\n• 직원 기숙사 운영 (일부 사업소)",
      },
      {
        title: "학자금 지원",
        desc: "본인 및 자녀 학자금 지원",
        detail:
          "• 본인 대학원 학자금: 학기당 200만원 한도\n• 자녀 대학교 학자금: 학기당 150만원 한도\n• 중·고등학교 자녀 학자금 전액 지원",
      },
      {
        title: "휴양시설",
        desc: "공사 보유 휴양시설 할인 이용",
        detail:
          "• 공사 콘도 우선 예약 및 할인 이용\n• 제휴 리조트 30~50% 할인\n• 가족 휴양지 연 1회 지원\n• 문화·체육시설 이용권 제공",
      },
    ],
  },
  {
    category: "노동조합 혜택",
    color: "#4F46E5",
    bg: "#EEF0FF",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    items: [
      {
        title: "경조사 지원 (조합)",
        desc: "조합 자체 경조사 지원금 별도 지급",
        detail:
          "• 본인 결혼: 20만원\n• 출산 축하금: 10만원\n• 부모·배우자 사망: 20만원\n• 조합 경조화환 제공\n• 공사 경조 지원금과 중복 수령 가능",
      },
      {
        title: "조합원 장학금",
        desc: "조합원 자녀 우수 장학금 지원",
        detail:
          "• 대학교 입학 장학금: 50만원\n• 성적 우수 장학금: 연 30만원\n• 특기·예체능 장학금: 연 20만원\n• 매년 상반기 신청 접수",
      },
      {
        title: "문화·여가 지원",
        desc: "문화생활 및 여가활동 지원",
        detail:
          "• 문화상품권 연 10만원 지급\n• 영화·공연 티켓 할인 (50%)\n• 체육대회·야유회 연 2회 개최\n• 조합원 동호회 활동비 지원",
      },
      {
        title: "교육·역량개발",
        desc: "조합원 직무 및 자기계발 교육 지원",
        detail:
          "• 직무교육 비용 지원: 연 30만원\n• 외국어 학원비 지원: 월 10만원\n• 자격증 취득 지원금: 합격 시 20만원\n• 노동법·권리 교육 정기 제공",
      },
      {
        title: "법률·심리 지원",
        desc: "법률 상담 및 심리 상담 무료 지원",
        detail:
          "• 법률 상담: 월 2회 무료 (제휴 법무법인)\n• 심리 상담: 연 10회 무료\n• 산업재해 처리 지원\n• 직장 내 괴롭힘 대응 지원",
      },
      {
        title: "복지포인트",
        desc: "조합원 복지포인트 연간 지급",
        detail:
          "• 연간 복지포인트 20만 포인트 지급\n• 사용처: 마트·온라인쇼핑·여행·의료 등\n• 매년 1월 일괄 지급\n• 미사용 포인트는 다음 해 이월 불가",
      },
    ],
  },
];

function WelfareDetail({ item, category, onBack }) {
  const catStyle = {
    "공사 혜택": { color: "#0EA5E9", bg: "#E0F2FE" },
    "노동조합 혜택": { color: "#4F46E5", bg: "#EEF0FF" },
  };
  const cat = catStyle[category] || catStyle["공사 혜택"];
  const lines = (item.detail || "")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s);

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "56px 20px 16px",
          background: "#fff",
          borderBottom: "1px solid #F3F4F6",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <Icon path="M15 19l-7-7 7-7" color="#1F2937" size={24} />
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>
          복지혜택 상세
        </span>
      </div>
      <div style={{ padding: "20px 16px" }}>
        <div
          style={{
            background: cat.bg,
            borderRadius: 16,
            padding: "20px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: cat.color,
              fontWeight: 700,
              marginBottom: 4,
            }}
          >
            {category}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1F2937" }}>
            {item.title}
          </div>
          <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>
            {item.description}
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "24px 20px",
            boxShadow: "0 2px 12px rgba(79,70,229,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#1F2937",
              marginBottom: 16,
            }}
          >
            지원 내용
          </div>
          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: cat.color,
                  flexShrink: 0,
                  marginTop: 6,
                }}
              />
              <span style={{ fontSize: 14, color: "#374151", lineHeight: 1.7 }}>
                {line}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 16,
            background: "#EEF0FF",
            borderRadius: 12,
            padding: "12px 16px",
            fontSize: 12,
            color: "#6B7280",
            lineHeight: 1.6,
          }}
        >
          💡 자세한 내용은 지회 사무실 또는 문의하기를 통해 확인하세요.
        </div>
      </div>
    </div>
  );
}

function WelfareScreen({ onBack, user }) {
  const [selectedCategory, setSelectedCategory] = useState("공사 혜택");
  const [selectedItem, setSelectedItem] = useState(null);
  const [welfareItems, setWelfareItems] = useState([]);
  const [welfareForm, setWelfareForm] = useState(null);
  const isAdmin = user?.is_admin;

  const catStyle = {
    "공사 혜택": {
      color: "#0EA5E9",
      bg: "#E0F2FE",
      icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    },
    "노동조합 혜택": {
      color: "#4F46E5",
      bg: "#EEF0FF",
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    },
  };
  const curStyle = catStyle[selectedCategory] || catStyle["공사 혜택"];

  const loadWelfare = () => {
    supabase
      .from("welfare")
      .select("*")
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (data) setWelfareItems(data);
      });
  };

  useEffect(() => {
    loadWelfare();
  }, []);

  const categories = ["공사 혜택", "노동조합 혜택"];
  const currentItems = welfareItems.filter(
    (it) => it.category === selectedCategory
  );

  const handleSaveWelfare = () => {
    if (!welfareForm.title.trim()) return;
    const payload = {
      category: welfareForm.category,
      title: welfareForm.title,
      description: welfareForm.description,
      detail: welfareForm.detail,
      sort_order: welfareForm.sort_order || 0,
    };
    if (welfareForm.id) {
      supabase
        .from("welfare")
        .update(payload)
        .eq("id", welfareForm.id)
        .then(() => {
          setWelfareForm(null);
          loadWelfare();
        });
    } else {
      supabase
        .from("welfare")
        .insert([payload])
        .then(() => {
          setWelfareForm(null);
          loadWelfare();
        });
    }
  };

  const handleDeleteWelfare = (id) => {
    supabase
      .from("welfare")
      .delete()
      .eq("id", id)
      .then(() => {
        loadWelfare();
      });
  };

  if (selectedItem) {
    return (
      <WelfareDetail
        item={selectedItem}
        category={selectedCategory}
        onBack={() => setSelectedItem(null)}
      />
    );
  }

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              대공원승무지회
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              복지혜택
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 4,
              }}
            >
              조합원의 권리 ·{" "}
              <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                당당하게 누리세요 🎁
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                flex: 1,
                padding: "10px 8px",
                borderRadius: 14,
                border: "2px solid",
                borderColor:
                  selectedCategory === cat ? "#fff" : "rgba(255,255,255,0.3)",
                background:
                  selectedCategory === cat ? "#fff" : "rgba(255,255,255,0.1)",
                color: selectedCategory === cat ? "#4F46E5" : "#fff",
                fontWeight: selectedCategory === cat ? 700 : 400,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: "12px 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 600 }}>
            총 {currentItems.length}개의 혜택
          </div>
          {isAdmin && (
            <button
              onClick={() =>
                setWelfareForm({
                  category: selectedCategory,
                  title: "",
                  description: "",
                  detail: "",
                  sort_order: currentItems.length + 1,
                })
              }
              style={{
                background: "#EEF0FF",
                color: "#4F46E5",
                border: "none",
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              + 혜택 추가
            </button>
          )}
        </div>
        {currentItems.map((item) => (
          <div
            key={item.id}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "18px 20px",
              marginBottom: 10,
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            }}
          >
            <div
              onClick={() => setSelectedItem(item)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: curStyle.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon path={curStyle.icon} color={curStyle.color} size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#1F2937",
                    marginBottom: 4,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#9CA3AF",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.description}
                </div>
              </div>
              <Icon path="M9 5l7 7-7 7" color="#D1D5DB" size={18} />
            </div>
            {isAdmin && (
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid #F3F4F6",
                }}
              >
                <button
                  onClick={() => setWelfareForm(item)}
                  style={{
                    flex: 1,
                    padding: "7px",
                    borderRadius: 6,
                    border: "none",
                    background: "#F3F4F6",
                    color: "#6B7280",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  수정
                </button>
                <button
                  onClick={() => {
                    if (window.confirm("이 혜택을 삭제할까요?"))
                      handleDeleteWelfare(item.id);
                  }}
                  style={{
                    flex: 1,
                    padding: "7px",
                    borderRadius: 6,
                    border: "none",
                    background: "#FEE2E2",
                    color: "#EF4444",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {welfareForm && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setWelfareForm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "24px 20px",
              width: "100%",
              maxWidth: 360,
              maxHeight: "80vh",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: "#1F2937",
                marginBottom: 18,
              }}
            >
              {welfareForm.id ? "혜택 수정" : "혜택 추가"} (
              {welfareForm.category})
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
              혜택 이름
            </div>
            <input
              value={welfareForm.title}
              onChange={(e) =>
                setWelfareForm({ ...welfareForm, title: e.target.value })
              }
              placeholder="예: 경조사 지원"
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                marginBottom: 14,
              }}
            />
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
              요약 설명
            </div>
            <input
              value={welfareForm.description || ""}
              onChange={(e) =>
                setWelfareForm({
                  ...welfareForm,
                  description: e.target.value,
                })
              }
              placeholder="예: 결혼·출산·사망 시 경조금 지원"
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                marginBottom: 14,
              }}
            />
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
              상세 내용 ( / 로 항목 구분)
            </div>
            <textarea
              value={welfareForm.detail || ""}
              onChange={(e) =>
                setWelfareForm({ ...welfareForm, detail: e.target.value })
              }
              placeholder="예: 본인 결혼 50만원 / 자녀 결혼 30만원 / 출산 30만원"
              rows={5}
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                marginBottom: 20,
                resize: "none",
              }}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setWelfareForm(null)}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  background: "#fff",
                  color: "#6B7280",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                취소
              </button>
              <button
                onClick={handleSaveWelfare}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 투표/설문 ──
const dummyVotes = [
  {
    id: 1,
    type: "투표",
    status: "진행중",
    title: "2024년 하반기 단체교섭 요구안 찬반 투표",
    desc: "하반기 단체교섭 요구안에 대한 조합원 찬반 의견을 수렴합니다.",
    deadline: "2024.05.25",
    total: 320,
    voted: 187,
    options: [
      { label: "찬성", count: 142, color: "#4F46E5" },
      { label: "반대", count: 38, color: "#EF4444" },
      { label: "기권", count: 7, color: "#9CA3AF" },
    ],
    userVoted: false,
  },
  {
    id: 2,
    type: "설문",
    status: "진행중",
    title: "근무환경 개선 설문조사",
    desc: "조합원 여러분의 근무환경 만족도와 개선 희망사항을 조사합니다.",
    deadline: "2024.05.30",
    total: 320,
    voted: 95,
    options: [
      { label: "매우 만족", count: 12, color: "#10B981" },
      { label: "만족", count: 38, color: "#4F46E5" },
      { label: "보통", count: 30, color: "#F59E0B" },
      { label: "불만족", count: 11, color: "#EF4444" },
      { label: "매우 불만족", count: 4, color: "#DC2626" },
    ],
    userVoted: false,
  },
  {
    id: 3,
    type: "투표",
    status: "종료",
    title: "조합원 총회 일정 투표",
    desc: "2024년 상반기 조합원 총회 날짜를 결정합니다.",
    deadline: "2024.05.10",
    total: 320,
    voted: 298,
    options: [
      { label: "5월 15일 (수)", count: 178, color: "#4F46E5" },
      { label: "5월 22일 (수)", count: 89, color: "#0EA5E9" },
      { label: "5월 29일 (수)", count: 31, color: "#9CA3AF" },
    ],
    userVoted: true,
  },
];

function VoteDetail({ vote, onBack, user }) {
  const optionLabels = Array.isArray(vote.options) ? vote.options : [];
  const colorPalette = [
    "#4F46E5",
    "#EF4444",
    "#10B981",
    "#F59E0B",
    "#0EA5E9",
    "#9CA3AF",
  ];
  const myId = String(user?.emp_id || user?.id || "guest");

  const [results, setResults] = useState([]);
  const [myVote, setMyVote] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const loadResults = () => {
    supabase
      .from("vote_results")
      .select("choice, member_id")
      .eq("vote_id", vote.id)
      .then(({ data }) => {
        if (data) {
          setResults(data);
          const mine = data.find((r) => r.member_id === myId);
          if (mine) {
            setSubmitted(true);
          }
        }
      });
  };

  useEffect(() => {
    loadResults();
  }, [vote.id]);

  const countOf = (label) => results.filter((r) => r.choice === label).length;
  const totalVotes = results.length;
  const getPercent = (label) =>
    totalVotes === 0 ? 0 : Math.round((countOf(label) / totalVotes) * 100);

  const handleVote = (idx) => {
    if (submitted || vote.status === "종료") return;
    setMyVote(idx);
  };

  const handleSubmit = () => {
    if (myVote === null) return;
    const choice = optionLabels[myVote];
    supabase
      .from("vote_results")
      .insert([{ vote_id: vote.id, member_id: myId, choice: choice }])
      .then(({ error }) => {
        if (!error) {
          setSubmitted(true);
          loadResults();
        }
      });
  };
  const handleRevote = () => {
    supabase
      .from("vote_results")
      .delete()
      .eq("vote_id", vote.id)
      .eq("member_id", myId)
      .then(() => {
        setSubmitted(false);
        setMyVote(null);
        loadResults();
      });
  };

  const showResult = vote.status === "종료";

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "56px 20px 16px",
          background: "#fff",
          borderBottom: "1px solid #F3F4F6",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
          }}
        >
          <Icon path="M15 19l-7-7 7-7" color="#1F2937" size={24} />
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>
          {vote.type} 상세
        </span>
      </div>

      <div style={{ padding: "20px 16px" }}>
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 12,
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                background: vote.type === "투표" ? "#EEF0FF" : "#D1FAE5",
                color: vote.type === "투표" ? "#4F46E5" : "#10B981",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                padding: "3px 8px",
              }}
            >
              {vote.type}
            </span>
            <span
              style={{
                background: vote.status === "진행중" ? "#FEF3C7" : "#F3F4F6",
                color: vote.status === "진행중" ? "#F59E0B" : "#9CA3AF",
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                padding: "3px 8px",
              }}
            >
              {vote.status}
            </span>
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 800,
              color: "#1F2937",
              marginBottom: 8,
              lineHeight: 1.4,
            }}
          >
            {vote.title}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#6B7280",
              lineHeight: 1.6,
              marginBottom: 12,
            }}
          >
            {vote.description}
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>
              📅 마감:{" "}
              <strong style={{ color: "#374151" }}>
                {vote.deadline || "미정"}
              </strong>
            </div>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>
              👥 참여:{" "}
              <strong style={{ color: "#4F46E5" }}>{totalVotes}명</strong>
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#1F2937",
              marginBottom: 16,
            }}
          >
            {showResult ? "결과" : "선택하세요"}
          </div>
          {optionLabels.map((label, i) => {
            const color = colorPalette[i % colorPalette.length];
            return (
              <div
                key={i}
                onClick={() => handleVote(i)}
                style={{
                  marginBottom: 12,
                  cursor: showResult ? "default" : "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {!showResult && (
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          border: `2px solid ${
                            myVote === i ? color : "#E5E7EB"
                          }`,
                          background: myVote === i ? color : "#fff",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: myVote === i ? 700 : 400,
                        color: "#1F2937",
                      }}
                    >
                      {label}
                    </span>
                  </div>
                  {showResult && (
                    <span
                      style={{ fontSize: 13, fontWeight: 700, color: color }}
                    >
                      {getPercent(label)}%
                    </span>
                  )}
                </div>
                {showResult && (
                  <div
                    style={{
                      background: "#F3F4F6",
                      borderRadius: 10,
                      height: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: color,
                        borderRadius: 10,
                        width: `${getPercent(label)}%`,
                        transition: "width 0.5s",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!submitted && vote.status === "진행중" && user && (
          <button
            onClick={handleSubmit}
            disabled={myVote === null}
            style={{
              width: "100%",
              padding: "15px",
              background:
                myVote === null
                  ? "#E5E7EB"
                  : "linear-gradient(135deg, #4F46E5, #6D28D9)",
              color: myVote === null ? "#9CA3AF" : "#fff",
              border: "none",
              borderRadius: 14,
              fontSize: 16,
              fontWeight: 700,
              cursor: myVote === null ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {vote.type} 참여하기
          </button>
        )}
        {submitted && (
          <div>
            <div
              style={{
                background: "#D1FAE5",
                borderRadius: 14,
                padding: "14px",
                textAlign: "center",
                fontSize: 14,
                fontWeight: 700,
                color: "#10B981",
                marginBottom: 10,
              }}
            >
              ✅ 참여 완료! 결과는 투표 마감 후 공개됩니다.
            </div>
            {vote.status === "진행중" && (
              <button
                onClick={handleRevote}
                style={{
                  width: "100%",
                  padding: "13px",
                  background: "#fff",
                  color: "#4F46E5",
                  border: "1.5px solid #C7D2FE",
                  borderRadius: 14,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                🔄 다시 선택하기
              </button>
            )}
          </div>
        )}
        {vote.status === "종료" && !submitted && (
          <div
            style={{
              background: "#F3F4F6",
              borderRadius: 14,
              padding: "14px",
              textAlign: "center",
              fontSize: 14,
              color: "#9CA3AF",
            }}
          >
            종료된 {vote.type}입니다.
          </div>
        )}
        {!user && vote.status === "진행중" && (
          <div
            style={{
              background: "#FEF3C7",
              borderRadius: 14,
              padding: "14px",
              textAlign: "center",
              fontSize: 13,
              color: "#F59E0B",
            }}
          >
            로그인 후 참여할 수 있습니다.
          </div>
        )}
      </div>
    </div>
  );
}

function VoteScreen({ onBack, user }) {
  const [filter, setFilter] = useState("전체");
  const [selectedVote, setSelectedVote] = useState(null);
  const [votes, setVotes] = useState([]);
  const [editVote, setEditVote] = useState(null);
  const isAdmin = user?.is_admin;

  const loadVotes = () => {
    supabase
      .from("votes")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setVotes(data);
      });
  };

  useEffect(() => {
    loadVotes();
  }, []);

  const handleSaveVote = () => {
    if (!editVote.title.trim()) return;
    supabase
      .from("votes")
      .update({
        title: editVote.title,
        description: editVote.description,
        deadline: editVote.deadline || null,
        status: editVote.status,
      })
      .eq("id", editVote.id)
      .then(() => {
        setEditVote(null);
        loadVotes();
      });
  };

  const handleDeleteVote = (id) => {
    supabase
      .from("vote_results")
      .delete()
      .eq("vote_id", id)
      .then(() => {
        supabase
          .from("votes")
          .delete()
          .eq("id", id)
          .then(() => {
            loadVotes();
          });
      });
  };

  if (selectedVote) {
    return (
      <VoteDetail
        vote={selectedVote}
        onBack={() => setSelectedVote(null)}
        user={user}
      />
    );
  }

  const filtered =
    filter === "전체"
      ? votes
      : votes.filter((v) => v.type === filter || v.status === filter);

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              대공원승무지회
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              투표/설문
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 4,
              }}
            >
              당신의 한 표가 ·{" "}
              <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                변화를 만듭니다 🗳️
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {["전체", "투표", "설문", "진행중", "종료"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "6px 12px",
                borderRadius: 20,
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                background: filter === f ? "#fff" : "rgba(255,255,255,0.15)",
                color: filter === f ? "#4F46E5" : "#fff",
                fontWeight: filter === f ? 700 : 400,
                fontSize: 12,
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 16px" }}>
        {filtered.map((vote) => (
          <div
            key={vote.id}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "18px 20px",
              marginBottom: 10,
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            }}
          >
            <div
              onClick={() => setSelectedVote(vote)}
              style={{ cursor: "pointer" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    background: vote.type === "투표" ? "#EEF0FF" : "#D1FAE5",
                    color: vote.type === "투표" ? "#4F46E5" : "#10B981",
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 6,
                    padding: "3px 8px",
                  }}
                >
                  {vote.type}
                </span>
                <span
                  style={{
                    background:
                      vote.status === "진행중" ? "#FEF3C7" : "#F3F4F6",
                    color: vote.status === "진행중" ? "#F59E0B" : "#9CA3AF",
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 6,
                    padding: "3px 8px",
                  }}
                >
                  {vote.status}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    color: "#9CA3AF",
                  }}
                >
                  ~ {vote.deadline || "미정"}
                </span>
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#1F2937",
                  marginBottom: 4,
                  lineHeight: 1.4,
                }}
              >
                {vote.title}
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                {vote.status === "진행중"
                  ? "참여하려면 눌러주세요"
                  : "결과를 보려면 눌러주세요"}
              </div>
            </div>
            {isAdmin && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid #F3F4F6",
                }}
              >
                <button
                  onClick={() => setEditVote(vote)}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 8,
                    border: "none",
                    background: "#F3F4F6",
                    color: "#6B7280",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  수정
                </button>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "이 투표를 삭제할까요? 투표 결과도 함께 삭제됩니다."
                      )
                    )
                      handleDeleteVote(vote.id);
                  }}
                  style={{
                    flex: 1,
                    padding: "8px",
                    borderRadius: 8,
                    border: "none",
                    background: "#FEE2E2",
                    color: "#EF4444",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        ))}
        {editVote && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: 20,
            }}
            onClick={() => setEditVote(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                borderRadius: 20,
                padding: "24px 20px",
                width: "100%",
                maxWidth: 360,
              }}
            >
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 18,
                }}
              >
                투표 수정
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
                제목
              </div>
              <input
                value={editVote.title}
                onChange={(e) =>
                  setEditVote({ ...editVote, title: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "11px 12px",
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  marginBottom: 14,
                }}
              />
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
                설명
              </div>
              <textarea
                value={editVote.description || ""}
                onChange={(e) =>
                  setEditVote({ ...editVote, description: e.target.value })
                }
                rows={3}
                style={{
                  width: "100%",
                  padding: "11px 12px",
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  marginBottom: 14,
                  resize: "none",
                }}
              />
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
                마감일
              </div>
              <input
                type="date"
                value={editVote.deadline || ""}
                onChange={(e) =>
                  setEditVote({ ...editVote, deadline: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "11px 12px",
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  marginBottom: 14,
                }}
              />
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
                상태
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                {["진행중", "종료"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setEditVote({ ...editVote, status: s })}
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: 10,
                      border:
                        editVote.status === s
                          ? "1.5px solid #4F46E5"
                          : "1.5px solid #E5E7EB",
                      background: editVote.status === s ? "#EEF0FF" : "#fff",
                      color: editVote.status === s ? "#4F46E5" : "#9CA3AF",
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => setEditVote(null)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: 10,
                    border: "1.5px solid #E5E7EB",
                    background: "#fff",
                    color: "#6B7280",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  취소
                </button>
                <button
                  onClick={handleSaveVote}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: 10,
                    border: "none",
                    background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 익명 제보 ──
const dummyReports = [
  {
    id: 1,
    category: "부당처우",
    title: "특정 관리자의 부당한 업무 지시 관련",
    content:
      "반복적으로 부당한 업무 지시를 받고 있습니다. 자세한 내용은 면담을 통해 말씀드리고 싶습니다.",
    date: "2024.05.18",
    status: "검토중",
  },
  {
    id: 2,
    category: "안전",
    title: "사업소 내 안전 설비 미비 제보",
    content:
      "신풍 사업소 특정 구역의 안전 설비가 오래되어 사고 위험이 있습니다.",
    date: "2024.05.15",
    status: "처리완료",
  },
  {
    id: 3,
    category: "기타",
    title: "근무 환경 개선 요청",
    content: "휴게실 시설이 너무 낙후되어 있습니다. 개선을 요청드립니다.",
    date: "2024.05.10",
    status: "검토중",
  },
];

const reportCategories = [
  "부당처우",
  "직장괴롭힘",
  "안전",
  "비리/비위",
  "근무환경",
  "기타",
];

function AnonymousReportWrite({ onBack, onSubmit }) {
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [done, setDone] = useState(false);
  const [accessCode, setAccessCode] = useState("");
const [showCheck, setShowCheck] = useState(false);
  const [checkCode, setCheckCode] = useState("");
  const [checkResult, setCheckResult] = useState(null);

  // 비밀번호로 내 제보 + 답변 확인하기
  const handleCheck = async () => {
    if (!checkCode.trim()) return;
    const { data } = await supabase
      .from("anonymous_reports")
      .select("*")
      .eq("access_code", checkCode.trim())
      .maybeSingle();
    setCheckResult(data || "notfound");
  };
  const handleSubmit = async () => {
    if (!category || !title.trim() || !content.trim()) return;
    // 본인 확인용 6자리 비밀번호 생성
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setAccessCode(code);
    // DB에 저장 (작성자 정보 없이 = 완전 익명)
    await supabase.from("anonymous_reports").insert({
      category,
      title: title.trim(),
      content: content.trim(),
      access_code: code,
    });
    onSubmit({ category, title, content });
    setDone(true);
  };

  if (done) {
    return (
      <div
        style={{
          maxWidth: 430,
          margin: "0 auto",
          fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
          background: "#F4F3FF",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "#EEF0FF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <Icon
            path="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            color="#4F46E5"
            size={40}
          />
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: "#1F2937",
            marginBottom: 12,
          }}
        >
          제보가 접수되었습니다
        </div>
        <div
          style={{
            fontSize: 14,
            color: "#6B7280",
            textAlign: "center",
            lineHeight: 1.7,
            marginBottom: 8,
          }}
        >
          작성자의 이름·사번 등 어떤 정보도 저장되지 않으며,
          <br />
          관리자도 누가 작성했는지 알 수 없습니다. 🔒
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#4F46E5",
            fontWeight: 600,
            marginBottom: 32,
          }}
        >
          검토 후 필요시 조치하겠습니다 🙏
        </div>
        <div
          style={{
            width: "100%",
            maxWidth: 320,
            background: "#fff",
            border: "2px dashed #4F46E5",
            borderRadius: 16,
            padding: "20px",
            marginBottom: 24,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 8 }}>
            🔑 나중에 답변을 확인할 비밀번호
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#4F46E5", letterSpacing: 4 }}>
            {accessCode}
          </div>
          <div style={{ fontSize: 12, color: "#EF4444", marginTop: 10, lineHeight: 1.6 }}>
            이 번호를 꼭 메모해 두세요!
            <br />
            번호가 없으면 답변을 확인할 수 없어요.
          </div>
        </div>
        <button
          onClick={onBack}
          style={{
            padding: "14px 40px",
            background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
            color: "#fff",
            border: "none",
            borderRadius: 14,
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          확인
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "56px 20px 16px",
          background: "#fff",
          borderBottom: "1px solid #F3F4F6",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#1F2937" size={24} />
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#1F2937" }}>
            익명 제보
          </span>
        </div>
        <button
          onClick={handleSubmit}
          style={{
            background:
              category && title && content
                ? "linear-gradient(135deg, #4F46E5, #6D28D9)"
                : "#E5E7EB",
            color: category && title && content ? "#fff" : "#9CA3AF",
            border: "none",
            borderRadius: 10,
            padding: "8px 18px",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
         제보하기
        </button>
      </div>

      <div style={{ padding: "20px 16px" }}>
        <button
          onClick={() => {
            setShowCheck(true);
            setCheckCode("");
            setCheckResult(null);
          }}
          style={{
            width: "100%",
            padding: "14px",
            marginBottom: 16,
            background: "#fff",
            border: "2px solid #4F46E5",
            borderRadius: 14,
            color: "#4F46E5",
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          🔑 내 제보 답변 확인하기
        </button>
        <div
          style={{
            background: "#EEF0FF",
            borderRadius: 14,
            padding: "14px 16px",
            marginBottom: 16,
            display: "flex",
            gap: 10,
          }}
        >
          <div style={{ flexShrink: 0, marginTop: 2 }}>
            <Icon
              path="M6 3v18M12 3v18M18 3v18M6 8c1.5 0 3-1 3-2.5M6 13c2 0 3.5-1 3.5-2.5M12 7c1.5 0 3-1 3-2.5M12 12c2 0 3.5-1 3.5-2.5M18 9c-1.5 0-3-1-3-2.5M18 14c-2 0-3.5-1-3.5-2.5"
              color="#4F46E5"
              size={18}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#4F46E5",
                marginBottom: 4,
              }}
            >
              완전한 익명이 보장됩니다
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.6 }}>
              제보자의 이름·사번 등은 일절 저장되지 않습니다. 관리자도 누가 작성했는지 알 수 없으니 안심하고 작성하세요.
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            boxShadow: "0 2px 12px rgba(79,70,229,0.06)",
          }}
        >
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#374151",
                marginBottom: 10,
              }}
            >
              제보 유형
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              {reportCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  style={{
                    padding: "10px 4px",
                    borderRadius: 10,
                    border: "1.5px solid",
                    borderColor: category === cat ? "#4F46E5" : "#E5E7EB",
                    background: category === cat ? "#EEF0FF" : "#fff",
                    color: category === cat ? "#4F46E5" : "#6B7280",
                    fontSize: 13,
                    fontWeight: category === cat ? 700 : 400,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="제목을 입력하세요"
            style={{
              width: "100%",
              padding: "13px 0",
              border: "none",
              borderBottom: "1.5px solid #E5E7EB",
              fontSize: 16,
              fontWeight: 600,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#1F2937",
              marginBottom: 16,
            }}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="제보 내용을 자세히 입력해주세요&#10;&#10;(언제, 어디서, 어떤 일이 있었는지 구체적으로 작성해 주시면 더 빠르게 처리할 수 있습니다)"
            rows={10}
            style={{
              width: "100%",
              padding: "0",
              border: "none",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
              color: "#374151",
              lineHeight: 1.8,
              resize: "none",
            }}
          />
        </div>
      </div>
      {showCheck && (
        <div
          onClick={() => setShowCheck(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 20,
              width: "100%",
              maxWidth: 360,
              maxHeight: "80vh",
              overflowY: "auto",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1F2937", marginBottom: 6 }}>
              🔑 내 제보 답변 확인
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16, lineHeight: 1.6 }}>
              제보할 때 받은 6자리 비밀번호를 입력하세요.
            </div>
            <input
              value={checkCode}
              onChange={(e) => setCheckCode(e.target.value)}
              placeholder="예: 482917"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                fontSize: 16,
                textAlign: "center",
                letterSpacing: 4,
                marginBottom: 12,
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={handleCheck}
              style={{
                width: "100%",
                padding: "12px 0",
                background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                marginBottom: 16,
              }}
            >
              확인하기
            </button>
            {checkResult === "notfound" && (
              <div style={{ fontSize: 13, color: "#EF4444", textAlign: "center", padding: "12px 0" }}>
                해당 번호의 제보를 찾을 수 없어요. 번호를 다시 확인해주세요.
              </div>
            )}
            {checkResult && checkResult !== "notfound" && (
              <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 16 }}>
                <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 4 }}>
                  {checkResult.category} · {checkResult.status}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2937", marginBottom: 8 }}>
                  {checkResult.title}
                </div>
                <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7, background: "#F9FAFB", borderRadius: 10, padding: "12px", marginBottom: 14, whiteSpace: "pre-wrap" }}>
                  {checkResult.content}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5", marginBottom: 6 }}>
                  💬 관리자 답변
                </div>
                {checkResult.admin_reply ? (
                  <div style={{ fontSize: 14, color: "#1F2937", lineHeight: 1.7, background: "#EEF0FF", borderRadius: 10, padding: "12px", whiteSpace: "pre-wrap" }}>
                    {checkResult.admin_reply}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#9CA3AF", padding: "8px 0" }}>
                    아직 답변이 등록되지 않았어요. 조금만 기다려 주세요.
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setShowCheck(false)}
              style={{
                width: "100%",
                padding: "12px 0",
                background: "#F3F4F6",
                color: "#6B7280",
                border: "none",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                marginTop: 16,
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AnonymousReportList({ onBack, onWrite, user }) {
  const isAdmin = user?.is_admin;

  const [reports, setReports] = useState([]);
const [selectedReport, setSelectedReport] = useState(null);
  const [replyText, setReplyText] = useState("");

  // 관리자 답변 저장
  const saveReply = async () => {
    if (!selectedReport) return;
    await supabase
      .from("anonymous_reports")
      .update({ admin_reply: replyText, status: "답변완료" })
      .eq("id", selectedReport.id);
    setReports((prev) =>
      prev.map((r) =>
        r.id === selectedReport.id
          ? { ...r, admin_reply: replyText, status: "답변완료" }
          : r
      )
    );
    setSelectedReport(null);
    setReplyText("");
    alert("답변이 저장되었습니다.");
  };
  // DB에서 익명제보 목록 불러오기
  useEffect(() => {
    supabase
      .from("anonymous_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data)
          setReports(
            data.map((r) => ({
              ...r,
              date: r.created_at?.slice(0, 10).replace(/-/g, "."),
            }))
          );
      });
    // 관리자가 제보 목록을 열면 모두 '읽음' 처리 (알림 사라짐)
    if (user?.is_admin) {
      supabase
        .from("anonymous_reports")
        .update({ admin_read: true })
        .eq("admin_read", false)
        .then(() => {});
    }
  }, []);

  // 관리자가 아니면 작성 화면으로 바로
  if (!isAdmin) {
    return <AnonymousReportWrite onBack={onBack} onSubmit={() => {}} />;
  }

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onBack}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "none",
                borderRadius: "50%",
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
            </button>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
                대공원승무지회
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
                익명 제보 관리
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.7)",
                  marginTop: 4,
                }}
              >
                관리자 ·{" "}
                <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                  전체 제보 목록
                </span>
              </div>
            </div>
          </div>
          <div
            style={{
              background: "rgba(255,255,255,0.2)",
              borderRadius: 10,
              padding: "6px 12px",
            }}
          >
            <span style={{ fontSize: 12, color: "#fff", fontWeight: 700 }}>
              ⚙️ 관리자
            </span>
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", marginTop: 8 }}>
        {reports.map((report, i) => (
          <div
            key={report.id}
            onClick={() => {
              setSelectedReport(report);
              setReplyText(report.admin_reply || "");
            }}
            style={{
              padding: "16px 20px",
              borderBottom:
                i < reports.length - 1 ? "1px solid #F3F4F6" : "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  background: "#EEF0FF",
                  color: "#4F46E5",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "2px 8px",
                }}
              >
                {report.category}
              </span>
              <span
                style={{
                  background:
                    report.status === "처리완료" ? "#D1FAE5" : "#FEF3C7",
                  color: report.status === "처리완료" ? "#10B981" : "#F59E0B",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "2px 8px",
                }}
              >
                {report.status}
              </span>
              <span
                style={{ marginLeft: "auto", fontSize: 11, color: "#9CA3AF" }}
              >
                {report.date}
              </span>
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#1F2937",
                marginBottom: 6,
              }}
            >
              {report.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "#6B7280",
                lineHeight: 1.5,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {report.content}
            </div>
          </div>
        ))}
        {selectedReport && (
          <div
            onClick={() => setSelectedReport(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: 20,
                width: "100%",
                maxWidth: 380,
                maxHeight: "80vh",
                overflowY: "auto",
              }}
            >
              <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 6 }}>
                {selectedReport.category} · {selectedReport.date}
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#1F2937", marginBottom: 12 }}>
                {selectedReport.title}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "#374151",
                  lineHeight: 1.7,
                  background: "#F9FAFB",
                  borderRadius: 12,
                  padding: "14px 16px",
                  marginBottom: 18,
                  whiteSpace: "pre-wrap",
                }}
              >
                {selectedReport.content}
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5", marginBottom: 8 }}>
                관리자 답변
              </div>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="제보자가 비밀번호로 확인할 답변을 작성하세요"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  minHeight: 100,
                  padding: "12px",
                  border: "1px solid #E5E7EB",
                  borderRadius: 10,
                  fontSize: 14,
                  fontFamily: "inherit",
                  resize: "vertical",
                  marginBottom: 16,
                }}
              />

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setSelectedReport(null)}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    background: "#F3F4F6",
                    color: "#6B7280",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  닫기
                </button>
                <button
                  onClick={saveReply}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  답변 저장
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 자료실 ──
const archiveCategories = [
  {
    id: "agreement",
    label: "단체협약",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    color: "#4F46E5",
    bg: "#EEF0FF",
    files: [
      { name: "2024년 단체협약서", size: "2.3MB", date: "2024.01.15" },
      { name: "2023년 단체협약서", size: "2.1MB", date: "2023.01.20" },
    ],
  },
  {
    id: "wage",
    label: "임금협약",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1",
    color: "#10B981",
    bg: "#D1FAE5",
    files: [
      { name: "2024년 임금협약서", size: "1.5MB", date: "2024.04.20" },
      { name: "수당 지급기준표", size: "0.8MB", date: "2024.04.20" },
    ],
  },
  {
    id: "negotiation",
    label: "교섭자료",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
    color: "#F59E0B",
    bg: "#FEF3C7",
    files: [
      { name: "2024년 단체교섭 요구안", size: "1.1MB", date: "2024.03.01" },
      { name: "교섭 회의록 (1차)", size: "0.5MB", date: "2024.03.10" },
    ],
  },
  {
    id: "past",
    label: "과거자료",
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    color: "#8B5CF6",
    bg: "#F3E8FF",
    files: [
      { name: "2023년 단체협약서", size: "2.1MB", date: "2023.04.15" },
      { name: "2023년 임금협약서", size: "1.4MB", date: "2023.05.20" },
    ],
  },
  {
    id: "rules",
    label: "규정",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    color: "#EC4899",
    bg: "#FCE7F3",
    files: [
      { name: "취업규칙", size: "1.8MB", date: "2024.03.01" },
      { name: "보수규정", size: "1.2MB", date: "2024.01.01" },
      { name: "수당 지급기준표", size: "0.8MB", date: "2024.01.01" },
    ],
  },
  {
    id: "labor",
    label: "노동법 자료",
    icon: "M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3",
    color: "#F59E0B",
    bg: "#FEF3C7",
    files: [
      { name: "근로기준법 (2024)", size: "3.1MB", date: "2024.02.01" },
      { name: "노동조합법", size: "2.4MB", date: "2024.02.01" },
      { name: "산업안전보건법 요약", size: "1.5MB", date: "2024.02.01" },
    ],
  },
];

function ArchiveScreen({ onBack, user }) {
  const isAdmin = user?.is_admin;
  const [selectedCat, setSelectedCat] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [dbFiles, setDbFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [favorites, setFavorites] = useState([]);
const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  // 새 분류 추가
  const handleAddCategory = async () => {
    if (!newCatName.trim()) { alert("분류 이름을 입력해주세요."); return; }
    const newCat = {
      id: "cat_" + Date.now(),
      label: newCatName.trim(),
      icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
      color: "#7C3AED",
      bg: "#EDE9FE",
    };
    const { error } = await supabase.from("archive_categories").insert(newCat);
    if (error) { alert("추가 실패: " + error.message); return; }
    setExtraCats((prev) => [...prev, newCat]);
    setNewCatName("");
    setShowAddCat(false);
    alert("분류가 추가되었습니다.");
  };
  // 내 즐겨찾기 목록 불러오기
  const loadFavorites = async () => {
    if (!user?.employee_number) return;
    const { data } = await supabase
      .from("archive_favorites")
      .select("file_id")
      .eq("employee_number", user.employee_number);
    if (data) setFavorites(data.map((f) => f.file_id));
  };

  useEffect(() => {
    loadFavorites();
  }, []);
  const [extraCats, setExtraCats] = useState([]);

  // 관리자가 추가한 분류 불러오기
  useEffect(() => {
    supabase
      .from("archive_categories")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setExtraCats(data);
      });
  }, []);

  // 코드 6개 + DB 추가분 합치기
  const allCats = [...archiveCategories, ...extraCats];

  const currentCat = allCats.find((c) => c.id === selectedCat);

  // Supabase에서 파일 목록 로드
  useEffect(() => {
    setLoading(true);
    supabase
      .from("archive_files")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) setDbFiles(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // 전체 파일 목록 (DB + 더미)
  const allFiles = dbFiles;
  // 즐겨찾기 켜기/끄기
  const toggleFavorite = async (file) => {
    const fid = String(file.id);
    if (favorites.includes(fid)) {
      setFavorites(favorites.filter((x) => x !== fid));
      await supabase
        .from("archive_favorites")
        .delete()
        .eq("employee_number", user.employee_number)
        .eq("file_id", fid);
    } else {
      setFavorites([...favorites, fid]);
      await supabase
        .from("archive_favorites")
        .insert({ employee_number: user.employee_number, file_id: fid });
    }
  };

  // 띄어쓰기 제거 후 비교하는 검색 헬퍼
  const normalize = (str) => (str || "").toLowerCase().replace(/\s+/g, "");

  // 검색 결과 (띄어쓰기 무시)
  const searchResults =
    searchQuery.trim().length > 0
      ? allFiles.filter((f) => {
          const q = normalize(searchQuery);
          return (
            normalize(f.name).includes(q) ||
            normalize(f.category_label).includes(q) ||
            normalize(f.description).includes(q)
          );
        })
      : [];

 const handleFileOpen = async (file) => {
    if (file.url) {
      window.open(file.url, "_blank");
    } else if (file.path) {
      const { data } = supabase.storage.from("archive").getPublicUrl(file.path);
      if (data?.publicUrl) window.open(data.publicUrl, "_blank");
    }
  };

  // 업로드 입력값
  const [upFile, setUpFile] = useState(null);
  const [upName, setUpName] = useState("");
  const [upCat, setUpCat] = useState("agreement");
  const [upDesc, setUpDesc] = useState("");
  const [uploading, setUploading] = useState(false);

  // 파일 업로드 처리
  const handleUpload = async () => {
    if (!upFile) { alert("PDF 파일을 선택해주세요."); return; }
    if (!upName.trim()) { alert("자료 제목을 입력해주세요."); return; }
    setUploading(true);
    try {
      const safeName = Date.now() + "_" + upFile.name.replace(/[^a-zA-Z0-9.]/g, "_");
      const path = upCat + "/" + safeName;
      const { error: upErr } = await supabase.storage.from("archive").upload(path, upFile);
      if (upErr) throw upErr;
      const catLabel = archiveCategories.find((c) => c.id === upCat)?.label || "";
      const sizeMB = (upFile.size / 1024 / 1024).toFixed(1) + "MB";
      const { error: dbErr } = await supabase.from("archive_files").insert({
        name: upName.trim(),
        category_id: upCat,
        category_label: catLabel,
        path: path,
        size: sizeMB,
        description: upDesc.trim() || null,
      });
      if (dbErr) throw dbErr;
      alert("자료가 등록되었습니다.");
      const { data } = await supabase.from("archive_files").select("*").order("created_at", { ascending: false });
      if (data) setDbFiles(data);
      setUpFile(null); setUpName(""); setUpDesc(""); setUpCat("agreement");
      setShowUpload(false);
   } catch (err) {
      alert("업로드 실패: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  // 파일 삭제 처리
  const handleDelete = async (file) => {
    if (!window.confirm('"' + file.name + '" 자료를 삭제하시겠습니까?')) return;
    try {
      if (file.path) {
        await supabase.storage.from("archive").remove([file.path]);
      }
      const { error } = await supabase.from("archive_files").delete().eq("id", file.id);
      if (error) throw error;
      const { data } = await supabase.from("archive_files").select("*").order("created_at", { ascending: false });
      setDbFiles(data || []);
      alert("삭제되었습니다.");
    } catch (err) {
      alert("삭제 실패: " + err.message);
    }
  };

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <button
            onClick={
              selectedCat
                ? () => {
                    setSelectedCat(null);
                    setSearchQuery("");
                  }
                : onBack
            }
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              대공원승무지회
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              {selectedCat ? currentCat?.label : "자료실"}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 4,
              }}
            >
              {selectedCat ? (
                "PDF 파일 목록"
              ) : (
                <span>
                  문서와 자료 ·{" "}
                  <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                    PDF로 제공돼요 📄
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
{isAdmin && !selectedCat && (
          <button
            onClick={() => setShowUpload(true)}
            style={{
              width: "100%",
              marginBottom: 12,
              padding: "10px 0",
              background: "rgba(255,255,255,0.2)",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: 10,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            + 자료 올리기
          </button>
        )}
        {isAdmin && !selectedCat && (
          <button
            onClick={() => setShowAddCat(true)}
            style={{
              width: "100%",
              marginBottom: 12,
              padding: "10px 0",
              background: "rgba(255,255,255,0.2)",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: 10,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            + 분류 추가
          </button>
        )}
        {/* 검색창 */}
        <div style={{ position: "relative" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(255,255,255,0.15)",
              borderRadius: 14,
              padding: "10px 16px",
              gap: 10,
              border: searchFocused
                ? "1.5px solid rgba(255,255,255,0.6)"
                : "1.5px solid transparent",
            }}
          >
            <Icon
              path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              color="rgba(255,255,255,0.8)"
              size={18}
            />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedCat(null);
              }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="호봉산정기준 확인, 단체협약 등 검색..."
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                fontSize: 14,
                color: "#fff",
                fontFamily: "inherit",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  background: "rgba(255,255,255,0.2)",
                  border: "none",
                  borderRadius: "50%",
                  width: 22,
                  height: 22,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 16px" }}>
        {/* 검색 결과 */}
        {searchQuery.trim().length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 12,
                color: "#9CA3AF",
                fontWeight: 600,
                marginBottom: 10,
              }}
            >
              🔍 "{searchQuery}" 검색 결과 · {searchResults.length}건
            </div>
            {searchResults.length === 0 ? (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  padding: "24px",
                  textAlign: "center",
                  boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                <div style={{ fontSize: 14, color: "#9CA3AF" }}>
                  검색 결과가 없습니다
                </div>
              </div>
            ) : (
              searchResults.map((file, i) => {
                const cat = archiveCategories.find(
                  (c) => c.id === file.category_id
                );
                return (
                  <div
                    key={i}
                    onClick={() => handleFileOpen(file)}
                    style={{
                      background: "#fff",
                      borderRadius: 16,
                      padding: "14px 18px",
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        background: "#FEE2E2",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 900,
                          color: "#EF4444",
                        }}
                      >
                        PDF
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#1F2937",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {file.name}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 3,
                        }}
                      >
                        {cat && (
                          <span
                            style={{
                              background: cat.bg,
                              color: cat.color,
                              fontSize: 10,
                              fontWeight: 700,
                              borderRadius: 6,
                              padding: "2px 6px",
                            }}
                          >
                            {cat.label}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                          {file.size} ·{" "}
                          {file.date || file.created_at?.slice(0, 10)}
                        </span>
                      </div>
                    </div>
                    <Icon
                      path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      color="#4F46E5"
                      size={20}
                    />
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 카테고리 목록 또는 파일 목록 */}
        {/* ⭐ 즐겨찾기 모아보기 */}
        {!searchQuery.trim() && !selectedCat && favorites.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6B7280", marginBottom: 10 }}>
              ⭐ 즐겨찾기 · {favorites.length}개
            </div>
            {dbFiles
              .filter((f) => favorites.includes(String(f.id)))
              .map((file, i) => {
                const cat = archiveCategories.find((c) => c.id === file.category_id);
                return (
                  <div
                    key={"fav" + i}
                    onClick={() => handleFileOpen(file)}
                    style={{
                      background: "#fff",
                      borderRadius: 16,
                      padding: "14px 18px",
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                      cursor: "pointer",
                      border: "1.5px solid #FDE68A",
                    }}
                  >
                    <span style={{ fontSize: 20, flexShrink: 0 }}>⭐</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1F2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 3 }}>
                        {cat?.label} · {file.size}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(file);
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, padding: 0, flexShrink: 0, lineHeight: 1 }}
                    >
                      ⭐
                    </button>
                  </div>
                );
              })}
          </div>
        )}
        {!searchQuery.trim() &&
          (!selectedCat ? (
            archiveCategories.map((cat) => {
              const fileCount = dbFiles.filter((f) => f.category_id === cat.id).length;
              return (
                <div
                  key={cat.id}
                  onClick={() => setSelectedCat(cat.id)}
                  style={{
                    background: "#fff",
                    borderRadius: 16,
                    padding: "18px 20px",
                    marginBottom: 10,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 14,
                      background: cat.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon path={cat.icon} color={cat.color} size={24} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#1F2937",
                      }}
                    >
                      {cat.label}
                    </div>
                    <div
                      style={{ fontSize: 12, color: "#9CA3AF", marginTop: 3 }}
                    >
                      PDF {fileCount}개
                    </div>
                  </div>
                  <Icon path="M9 5l7 7-7 7" color="#D1D5DB" size={18} />
                </div>
              );
            })
          ) : (
            <>
              <div
                style={{
                  fontSize: 12,
                  color: "#9CA3AF",
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                총{" "}
                {
                  (dbFiles.length > 0
                    ? dbFiles.filter((f) => f.category_id === selectedCat)
                    : currentCat?.files ?? []
                  ).length
                }
                개의 PDF 파일
              </div>
              {dbFiles.filter((f) => f.category_id === selectedCat).map((file, i) => (
                <div
                  key={i}
                  onClick={() => handleFileOpen(file)}
                  style={{
                    background: "#fff",
                    borderRadius: 16,
                    padding: "16px 20px",
                    marginBottom: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: "#FEE2E2",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 900,
                        color: "#EF4444",
                      }}
                    >
                      PDF
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#1F2937",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.name}
                    </div>
                    <div
                      style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}
                    >
                      {file.size} · {file.date || file.created_at?.slice(0, 10)}
                    </div>
                  </div>
                 <Icon
                    path="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    color="#4F46E5"
                    size={20}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(file);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 22,
                      padding: 0,
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    {favorites.includes(String(file.id)) ? "⭐" : "☆"}
                  </button>
                  {isAdmin && file.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(file);
                      }}
                      style={{
                        background: "#FEE2E2",
                        border: "none",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 12,
                        color: "#EF4444",
                        fontWeight: 700,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      삭제
                    </button>
                  )}
                </div>
              ))}
              <div
                style={{
                  background: "#EEF0FF",
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 12,
                  color: "#6B7280",
                  lineHeight: 1.6,
                  marginTop: 4,
                }}
              >
                💡 파일은 PDF 형식으로만 제공됩니다. 클릭하면 바로 열립니다.
              </div>
            </>
         ))}
      </div>

      {showUpload && (
        <div
          onClick={() => !uploading && setShowUpload(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 20,
              width: "100%",
              maxWidth: 360,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 16, color: "#1F2937" }}>
              자료 올리기 📄
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>
              PDF 파일
            </div>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setUpFile(e.target.files?.[0] || null)}
              style={{ width: "100%", marginBottom: 14, fontSize: 13 }}
            />

            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>
              제목
            </div>
            <input
              value={upName}
              onChange={(e) => setUpName(e.target.value)}
              placeholder="예: 2024년 단체협약서"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 14,
              }}
            />

            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>
              분류
            </div>
            <select
              value={upCat}
              onChange={(e) => setUpCat(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 14,
                background: "#fff",
              }}
            >
              {archiveCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>

            <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", marginBottom: 6 }}>
              설명 (선택)
            </div>
            <input
              value={upDesc}
              onChange={(e) => setUpDesc(e.target.value)}
              placeholder="간단한 설명 (검색에 사용돼요)"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 18,
              }}
            />

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowUpload(false)}
                disabled={uploading}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  background: "#F3F4F6",
                  color: "#6B7280",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                취소
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  background: uploading ? "#A5B4FC" : "#4F46E5",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {uploading ? "올리는 중..." : "올리기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCat && (
        <div
          onClick={() => setShowAddCat(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 20,
              width: "100%",
              maxWidth: 340,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1F2937", marginBottom: 6 }}>
              새 분류 추가 📁
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>
              분류 이름을 입력하세요. (예: 복지자료, 교육자료)
            </div>
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="분류 이름"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "12px",
                border: "1px solid #E5E7EB",
                borderRadius: 10,
                fontSize: 14,
                marginBottom: 18,
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowAddCat(false)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  background: "#F3F4F6",
                  color: "#6B7280",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                취소
              </button>
              <button
                onClick={handleAddCategory}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ── 지회 소개 ──
const dummyMembers = [
  {
    id: 1,
    name: "엄희태",
    role: "지회장",
    phone: "010-0000-0001",
    joinDate: "2010.03.01",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 2,
    name: "이석의",
    role: "대의원",
    phone: "010-0000-0002",
    joinDate: "2012.05.15",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 3,
    name: "윤성국",
    role: "대의원",
    phone: "010-0000-0003",
    joinDate: "2013.08.20",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 4,
    name: "강태준",
    role: "대의원",
    phone: "010-0000-0004",
    joinDate: "2015.03.10",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 5,
    name: "김철수",
    role: "조합원",
    phone: "010-0000-0005",
    joinDate: "2016.07.01",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 6,
    name: "이영희",
    role: "조합원",
    phone: "010-0000-0006",
    joinDate: "2018.02.14",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 7,
    name: "박민준",
    role: "조합원",
    phone: "010-0000-0007",
    joinDate: "2019.11.05",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 8,
    name: "홍길동",
    role: "조합원",
    phone: "010-0000-0008",
    joinDate: "2020.04.01",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 9,
    name: "최지훈",
    role: "조합원",
    phone: "010-0000-0009",
    joinDate: "2021.09.15",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 10,
    name: "정수연",
    role: "조합원",
    phone: "010-0000-0010",
    joinDate: "2022.01.03",
    password: "union1234a",
    is_temp_password: false,
  },
  {
    id: 11,
    name: "김주호",
    role: "조합원",
    phone: "010-0000-0011",
    joinDate: "2023.03.01",
    password: "union1234a",
    is_temp_password: false,
  },
];

function AboutScreen({ onBack, initialTab = "intro", user }) {
  const [orgTab, setOrgTab] = useState("지회");
  const [tab, setTab] = useState(initialTab);
  const [members, setMembers] = useState([]);
  const [kickTarget, setKickTarget] = useState(null);
  const [contactTarget, setContactTarget] = useState(null);
  const [stationFilter, setStationFilter] = useState("전체");
  const [memberCount, setMemberCount] = useState(0);
  const [memberSearch, setMemberSearch] = useState("");
  useEffect(() => {
    supabase
      .from("members")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) {
          setMembers(data);
          setMemberCount(data.filter((m) => m.is_union === true).length);

        }
      });
  }, []);
  // ── 조직도(간부) 기능 ──
  const [officers, setOfficers] = useState([]);
  const [officerForm, setOfficerForm] = useState(null);
  const isAdmin = user?.is_admin;

  const officerColor = (role) => {
    if (role === "지회장") return { color: "#4F46E5", bg: "#EEF0FF" };
    if (role === "본부장") return { color: "#10B981", bg: "#D1FAE5" };
    if (role === "사무국장") return { color: "#10B981", bg: "#D1FAE5" };
    return { color: "#0EA5E9", bg: "#E0F2FE" };
  };

  const loadOfficers = () => {
    supabase
      .from("officers")
      .select("*")
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (data) setOfficers(data);
      });
  };

  useEffect(() => {
    loadOfficers();
  }, []);

  const handleSaveOfficer = () => {
    if (!officerForm.role.trim() || !officerForm.name.trim()) return;
    const payload = {
      org_group: officerForm.org_group,
      role: officerForm.role,
      name: officerForm.name,
      description: officerForm.description,
      sort_order: officerForm.sort_order || 0,
    };
    if (officerForm.id) {
      supabase
        .from("officers")
        .update(payload)
        .eq("id", officerForm.id)
        .then(() => {
          setOfficerForm(null);
          loadOfficers();
        });
    } else {
      supabase
        .from("officers")
        .insert([payload])
        .then(() => {
          setOfficerForm(null);
          loadOfficers();
        });
    }
  };

  const handleDeleteOfficer = (id) => {
    supabase
      .from("officers")
      .delete()
      .eq("id", id)
      .then(() => {
        loadOfficers();
      });
  };

  const jihoeOfficers = officers.filter((o) => o.org_group === "지회");
  const bonbuOfficers = officers.filter((o) => o.org_group === "본부");

  const executives = [
    {
      role: "지회장",
      name: "엄희태",
      desc: "대공원승무지회를 대표합니다",
      color: "#4F46E5",
      bg: "#EEF0FF",
    },
    {
      role: "대의원",
      name: "이석의",
      desc: "조합원의 의견을 대변합니다",
      color: "#0EA5E9",
      bg: "#E0F2FE",
    },
    {
      role: "대의원",
      name: "윤성국",
      desc: "조합원의 의견을 대변합니다",
      color: "#0EA5E9",
      bg: "#E0F2FE",
    },
    {
      role: "대의원",
      name: "강태준",
      desc: "조합원의 의견을 대변합니다",
      color: "#0EA5E9",
      bg: "#E0F2FE",
    },
  ];

  const stationColor = { 대공원: "#4F46E5", 도봉: "#0EA5E9", 신풍: "#10B981" };
  const filteredMembers =
    stationFilter === "전체"
      ? dummyMembers
      : dummyMembers.filter((m) => (m as any).station === stationFilter);

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 28px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              서울교통공사노동조합
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              지회 소개
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 4,
              }}
            >
              함께하면 ·{" "}
              <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                더 강해집니다 💪
              </span>
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <EmblemImg
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.5)",
              objectFit: "cover",
              background: "#fff",
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              서울교통공사노동조합
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 900,
                color: "#fff",
                letterSpacing: -0.5,
              }}
            >
              대공원승무지회
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.8)",
                marginTop: 4,
              }}
            >
              우리 모두의 한 걸음 · 노동조건 변화의 시작
            </div>
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(255,255,255,0.15)",
            borderRadius: 20,
            padding: "8px 16px",
          }}
        >
          <Icon
            path="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            color="#fff"
            size={16}
          />
          <span style={{ fontSize: 13, color: "#fff" }}>
            현재 조합원 수 <strong>{memberCount}명</strong>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {[
            { key: "intro", label: "조직도" },
            { key: "members", label: "조합원 명단" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1,
                padding: "10px",
                borderRadius: 14,
                border: "2px solid",
                borderColor: tab === t.key ? "#fff" : "rgba(255,255,255,0.3)",
                background: tab === t.key ? "#fff" : "rgba(255,255,255,0.1)",
                color: tab === t.key ? "#4F46E5" : "#fff",
                fontWeight: tab === t.key ? 700 : 400,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        {tab === "intro" ? (
          <>
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                padding: "20px",
                marginBottom: 12,
                boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 4,
                    height: 18,
                    background: "#4F46E5",
                    borderRadius: 2,
                  }}
                />
                지회 소개
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: "#374151",
                  lineHeight: 1.8,
                  margin: 0,
                }}
              >
                대공원승무지회는 서울교통공사 대공원승무사업소 소속 직원들로
                구성된 노동조합 지회입니다.
              </p>
              <p
                style={{
                  fontSize: 14,
                  color: "#374151",
                  lineHeight: 1.8,
                  margin: "12px 0 0",
                }}
              >
                조합원의 노동권 보호와 노동환경 개선을 위해 적극적으로 활동하며,
                공정하고 안전한 일터를 만들기 위해 노력하고 있습니다.
              </p>
              <div
                style={{
                  marginTop: 16,
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 8,
                }}
              >
                {[
                  {
                    name: "대공원승무지회",
                    key: "지회",
                    color: "#4F46E5",
                    bg: "#EEF0FF",
                  },
                  {
                    name: "승무본부",
                    key: "본부",
                    color: "#10B981",
                    bg: "#D1FAE5",
                  },
                ].map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setOrgTab(s.key)}
                    style={{
                      background: orgTab === s.key ? s.color : s.bg,
                      borderRadius: 12,
                      padding: "14px 8px",
                      textAlign: "center",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "all 0.2s",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: orgTab === s.key ? "#fff" : s.color,
                      }}
                    >
                      {s.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color:
                          orgTab === s.key
                            ? "rgba(255,255,255,0.8)"
                            : "#9CA3AF",
                        marginTop: 4,
                      }}
                    >
                      {s.key === "지회" ? "간부 보기" : "본부 간부 보기"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {orgTab === "지회" ? (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  padding: "20px",
                  marginBottom: 12,
                  boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: "#1F2937",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 4,
                        height: 18,
                        background: "#4F46E5",
                        borderRadius: 2,
                      }}
                    />
                    집행부 소개
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() =>
                        setOfficerForm({
                          org_group: "지회",
                          role: "",
                          name: "",
                          description: "",
                          sort_order: jihoeOfficers.length + 1,
                        })
                      }
                      style={{
                        background: "#EEF0FF",
                        color: "#4F46E5",
                        border: "none",
                        borderRadius: 8,
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      + 추가
                    </button>
                  )}
                </div>
                {jihoeOfficers.map((exec, i) => {
                  const cc = officerColor(exec.role);
                  return (
                    <div
                      key={exec.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "14px 0",
                        borderBottom:
                          i < jihoeOfficers.length - 1
                            ? "1px solid #F3F4F6"
                            : "none",
                      }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 14,
                          background: cc.bg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon
                          path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          color={cc.color}
                          size={24}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <span
                          style={{
                            background: cc.bg,
                            color: cc.color,
                            fontSize: 11,
                            fontWeight: 700,
                            borderRadius: 6,
                            padding: "2px 8px",
                          }}
                        >
                          {exec.role}
                        </span>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 800,
                            color: "#1F2937",
                            marginTop: 4,
                          }}
                        >
                          {exec.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#9CA3AF",
                            marginTop: 2,
                          }}
                        >
                          {exec.description}
                        </div>
                      </div>
                      {isAdmin && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => setOfficerForm(exec)}
                            style={{
                              background: "#F3F4F6",
                              color: "#6B7280",
                              border: "none",
                              borderRadius: 6,
                              padding: "4px 10px",
                              fontSize: 12,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDeleteOfficer(exec.id)}
                            style={{
                              background: "#FEE2E2",
                              color: "#EF4444",
                              border: "none",
                              borderRadius: 6,
                              padding: "4px 10px",
                              fontSize: 12,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  padding: "20px",
                  marginBottom: 12,
                  boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      color: "#1F2937",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 4,
                        height: 18,
                        background: "#10B981",
                        borderRadius: 2,
                      }}
                    />
                    승무본부 간부
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() =>
                        setOfficerForm({
                          org_group: "본부",
                          role: "",
                          name: "",
                          description: "",
                          sort_order: bonbuOfficers.length + 1,
                        })
                      }
                      style={{
                        background: "#D1FAE5",
                        color: "#10B981",
                        border: "none",
                        borderRadius: 8,
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      + 추가
                    </button>
                  )}
                </div>
                {bonbuOfficers.map((exec, i) => {
                  const cc = officerColor(exec.role);
                  return (
                    <div
                      key={exec.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "14px 0",
                        borderBottom:
                          i < bonbuOfficers.length - 1
                            ? "1px solid #F3F4F6"
                            : "none",
                      }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 14,
                          background: cc.bg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon
                          path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          color={cc.color}
                          size={24}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <span
                          style={{
                            background: cc.bg,
                            color: cc.color,
                            fontSize: 11,
                            fontWeight: 700,
                            borderRadius: 6,
                            padding: "2px 8px",
                          }}
                        >
                          {exec.role}
                        </span>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 800,
                            color: "#1F2937",
                            marginTop: 4,
                          }}
                        >
                          {exec.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#9CA3AF",
                            marginTop: 2,
                          }}
                        >
                          {exec.description}
                        </div>
                      </div>
                      {isAdmin && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => setOfficerForm(exec)}
                            style={{
                              background: "#F3F4F6",
                              color: "#6B7280",
                              border: "none",
                              borderRadius: 6,
                              padding: "4px 10px",
                              fontSize: 12,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDeleteOfficer(exec.id)}
                            style={{
                              background: "#FEE2E2",
                              color: "#EF4444",
                              border: "none",
                              borderRadius: 6,
                              padding: "4px 10px",
                              fontSize: 12,
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div
              style={{
                background:
                  "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
                borderRadius: 20,
                padding: "24px 20px",
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.8)",
                  marginBottom: 8,
                }}
              >
                우리의 슬로건
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  color: "#fff",
                  lineHeight: 1.6,
                }}
              >
                "우리 모두의 한 걸음,
                <br />
                노동조건 변화의 시작"
              </div>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                해방역에 닿을 때까지 🚇
              </div>
            </div>
            {officerForm && (
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "rgba(0,0,0,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 1000,
                  padding: 20,
                }}
                onClick={() => setOfficerForm(null)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: "#fff",
                    borderRadius: 20,
                    padding: "24px 20px",
                    width: "100%",
                    maxWidth: 360,
                  }}
                >
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      color: "#1F2937",
                      marginBottom: 18,
                    }}
                  >
                    {officerForm.id ? "간부 수정" : "간부 추가"} (
                    {officerForm.org_group})
                  </div>
                  <div
                    style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}
                  >
                    직책
                  </div>
                  <input
                    value={officerForm.role}
                    onChange={(e) =>
                      setOfficerForm({ ...officerForm, role: e.target.value })
                    }
                    placeholder="예: 지회장, 대의원, 본부장"
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1.5px solid #E5E7EB",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      marginBottom: 14,
                    }}
                  />
                  <div
                    style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}
                  >
                    이름
                  </div>
                  <input
                    value={officerForm.name}
                    onChange={(e) =>
                      setOfficerForm({ ...officerForm, name: e.target.value })
                    }
                    placeholder="이름을 입력하세요"
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1.5px solid #E5E7EB",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      marginBottom: 14,
                    }}
                  />
                  <div
                    style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}
                  >
                    설명 (선택)
                  </div>
                  <input
                    value={officerForm.description || ""}
                    onChange={(e) =>
                      setOfficerForm({
                        ...officerForm,
                        description: e.target.value,
                      })
                    }
                    placeholder="예: 조합원의 의견을 대변합니다"
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1.5px solid #E5E7EB",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      marginBottom: 14,
                    }}
                  />
                  <div
                    style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}
                  >
                    표시 순서 (숫자)
                  </div>
                  <input
                    type="number"
                    value={officerForm.sort_order || 0}
                    onChange={(e) =>
                      setOfficerForm({
                        ...officerForm,
                        sort_order: parseInt(e.target.value) || 0,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: "1.5px solid #E5E7EB",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      marginBottom: 20,
                    }}
                  />
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => setOfficerForm(null)}
                      style={{
                        flex: 1,
                        padding: "12px",
                        borderRadius: 10,
                        border: "1.5px solid #E5E7EB",
                        background: "#fff",
                        color: "#6B7280",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSaveOfficer}
                      style={{
                        flex: 1,
                        padding: "12px",
                        borderRadius: 10,
                        border: "none",
                        background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      저장
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {kickTarget && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 999,
                  padding: 24,
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 20,
                    padding: "28px 24px",
                    width: "100%",
                    maxWidth: 360,
                  }}
                >
                  <div style={{ textAlign: "center", marginBottom: 16 }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 800,
                        color: "#1F2937",
                        marginBottom: 8,
                      }}
                    >
                      방출 확인
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        color: "#6B7280",
                        lineHeight: 1.7,
                      }}
                    >
                      <strong style={{ color: "#EF4444" }}>
                        {kickTarget.name}
                      </strong>{" "}
                      조합원을 방출하시겠습니까?
                      <br />
                      방출 즉시 앱 접근이 차단되며
                      <br />
                      다시 가입 승인을 받아야 합니다.
                      <br />
                      <br />
                      <span style={{ color: "#EF4444", fontWeight: 700 }}>
                        ⚠️ 당사자의 모든 개인정보 및<br />
                        데이터는 복구 불능으로 즉시 폐기됩니다.
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setKickTarget(null)}
                      style={{
                        flex: 1,
                        padding: "12px",
                        background: "#F3F4F6",
                        color: "#6B7280",
                        border: "none",
                        borderRadius: 12,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      취소
                    </button>
                    <button
                      onClick={() => {
                        // 방출 - DB에서 복구 불능 삭제
                        supabase
                          .from("members")
                          .delete()
                          .eq("name", kickTarget.name)
                          .then(() => {});
                        setMembers((prev) =>
                          prev.filter((m) => m.id !== kickTarget.id)
                        );
                        setKickTarget(null);
                      }}
                      style={{
                        flex: 1,
                        padding: "12px",
                        background: "#EF4444",
                        color: "#fff",
                        border: "none",
                        borderRadius: 12,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      ⛔ 방출
                    </button>
                  </div>
                </div>
              </div>
            )}
            {contactTarget && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 999,
                  padding: 24,
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 20,
                    padding: "28px 24px",
                    width: "100%",
                    maxWidth: 360,
                  }}
                >
                  <div style={{ textAlign: "center", marginBottom: 20 }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 800,
                        color: "#1F2937",
                        marginBottom: 4,
                      }}
                    >
                      {contactTarget.name}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        color: "#4F46E5",
                        fontWeight: 600,
                      }}
                    >
                      {contactTarget.phone}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <a
                      href={`tel:${contactTarget.phone}`}
                      style={{
                        flex: 1,
                        padding: "14px",
                        background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 12,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textDecoration: "none",
                        textAlign: "center",
                      }}
                    >
                      📞 전화
                    </a>
                    <a
                      href={`sms:${contactTarget.phone}`}
                      style={{
                        flex: 1,
                        padding: "14px",
                        background: "#EEF0FF",
                        color: "#4F46E5",
                        border: "none",
                        borderRadius: 12,
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textDecoration: "none",
                        textAlign: "center",
                      }}
                    >
                      💬 문자
                    </a>
                  </div>
                  <button
                    onClick={() => setContactTarget(null)}
                    style={{
                      width: "100%",
                      padding: "12px",
                      background: "#F3F4F6",
                      color: "#6B7280",
                      border: "none",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}

            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                overflow: "hidden",
                boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                marginBottom: 12,
              }}
            >
              <div style={{ padding: "10px 12px", borderBottom: "1px solid #F3F4F6" }}>
                <input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="이름 또는 연락처로 검색"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "9px 12px",
                    border: "1px solid #E5E7EB",
                    borderRadius: 10,
                    fontSize: 13,
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <div
                style={{
                  padding: "10px 16px",
                  background: "#F8F7FF",
                  borderBottom: "1px solid #F3F4F6",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    flex: 1.2,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                                        style={{ fontSize: 12, fontWeight: 700, color: "#1F2937", paddingLeft: 38 }}
                  >
                    이름
                  </span>
                
                </div>
                <div
                  style={{
                    flex: 1.3,
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1F2937",
                    textAlign: "center",
                  }}
                >
                  연락처
                </div>
                <div
                  style={{
                    flex: 0.9,
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1F2937",
                    textAlign: "center",
                  }}
                >
                  입사일
                </div>
              </div>
              {members
                .filter((m) => m.is_union === true)
                .filter((m) => {
                  const q = memberSearch.trim();
                  if (!q) return true;
                  return (m.name || "").includes(q) || (m.phone || "").includes(q);
                })
                .sort((a, b) => {
                  const ka = /^[가-힣]/.test(a.name || "");
                  const kb = /^[가-힣]/.test(b.name || "");
                  if (ka && !kb) return -1;
                  if (!ka && kb) return 1;
                  return (a.name || "").localeCompare(b.name || "", "ko");
                })
                .map((m, i) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderBottom:
                      i < members.filter((mm) => mm.is_union === true).length - 1 ? "1px solid #F3F4F6" : "none",
                  }}
                >
                  <div
                    style={{
                      flex: 1.2,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: "#EEF0FF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon
                        path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        color="#4F46E5"
                        size={14}
                      />
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#1F2937",
                        }}
                      >
                        {m.name}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color:
                            m.role === "지회장"
                              ? "#4F46E5"
                              : m.role === "대의원"
                              ? "#0EA5E9"
                              : "#9CA3AF",
                          fontWeight: m.role !== "조합원" ? 700 : 400,
                        }}
                      >
                        {m.role}
                      </div>
                    </div>
                  </div>
                  <div style={{ flex: 1.3, textAlign: "center" }}>
                    <span
                      onClick={() => setContactTarget(m)}
                      style={{
                        fontSize: 11,
                        color: "#4F46E5",
                        fontWeight: 600,
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {m.phone}
                    </span>
                  </div>
                  <div style={{ flex: 0.9, textAlign: "center" }}>
                    <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                      {m.joinDate}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                background: "#EEF0FF",
                borderRadius: 12,
                padding: "12px 16px",
                fontSize: 12,
                color: "#6B7280",
                lineHeight: 1.6,
              }}
            >
              💡 조합원 명단은 DB 연동 후 실제 데이터로 업데이트됩니다.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 관리자 화면 ──
const dummyPendingMembers = [
  {
    id: 11,
    name: "김지수",
    emp_id: "20240101",
    phone: "010-1234-5678",
    work_type: "교대",
    status: "pending",
    date: "2024.05.18",
  },
  {
    id: 12,
    name: "박현우",
    emp_id: "20240102",
    phone: "010-2345-6789",
    work_type: "통상",
    status: "pending",
    date: "2024.05.17",
  },
  {
    id: 13,
    name: "이수진",
    emp_id: "20240103",
    phone: "010-3456-7890",
    work_type: "교번",
    status: "pending",
    date: "2024.05.16",
  },
];
// ── 조합원 명단 관리 (관리자용) ──
function MemberManageScreen() {
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [unionFilter, setUnionFilter] = useState("전체");
  const [form, setForm] = useState(null);

  const loadMembers = () => {
    supabase
      .from("members")
      .select("*")
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (data) setMembers(data);
      });
  };

  useEffect(() => {
    loadMembers();
  }, []);

  const filtered = members.filter(
    (m) =>
      !search.trim() ||
      m.name.includes(search.trim()) ||
      (m.employee_number || "").includes(search.trim())
  ).filter((m) =>
    unionFilter === "전체"
      ? true
      : unionFilter === "조합원"
      ? m.is_union === true
      : m.is_union !== true
  );

  const handleSave = () => {
    if (!form.name.trim() || !form.employee_number.trim()) {
      alert("이름과 사번은 필수입니다.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      employee_number: form.employee_number.trim(),
      phone: form.phone,
      role: form.role || "조합원",
      is_union: form.is_union === true,
    };
    if (form.id) {
      supabase
        .from("members")
        .update(payload)
        .eq("id", form.id)
        .then(({ error }) => {
          if (error) {
            alert("저장 실패: " + error.message);
          } else {
            setForm(null);
            loadMembers();
          }
        });
    } else {
      supabase
        .from("members")
        .insert([
          {
            ...payload,
            password: "union0000",
            is_temp_password: true,
            status: "명단",
            is_admin: false,
            is_app_user: false,
          },
        ])
        .then(({ error }) => {
          if (error) {
            alert("추가 실패: " + error.message);
          } else {
            setForm(null);
            loadMembers();
          }
        });
    }
  };

  const [deleteTarget, setDeleteTarget] = useState(null);

  const handleDelete = (m) => {
    supabase
      .from("members")
      .delete()
      .eq("id", m.id)
      .then(() => {
        setDeleteTarget(null);
        loadMembers();
      });
  };

  const toggleAdmin = (m) => {
    supabase
      .from("members")
      .update({ is_admin: !m.is_admin })
      .eq("id", m.id)
      .then(() => loadMembers());
  };
  const handleResetPw = (m) => {
    if (
      !window.confirm(
        `${m.name} 조합원의 비밀번호를 union0000으로 초기화할까요?`
      )
    )
      return;
    supabase
      .from("members")
      .update({ password: "union0000", is_temp_password: true })
      .eq("id", m.id)
      .then(({ error }) => {
        if (error) {
          alert("초기화 실패: " + error.message);
        } else {
          alert(
            `${m.name} 조합원의 비밀번호가 union0000으로 초기화되었습니다.`
          );
          loadMembers();
        }
      });
  };
  

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: "#1F2937" }}>
          사업소인원 (현원 {members.filter((m) => !(m.name || "").includes("결원")).length}명 / 결원 {members.filter((m) => (m.name || "").includes("결원")).length}명)
        </div>
               <button
          onClick={() =>
            setForm({
              name: "",
              employee_number: "",
              phone: "",
              role: "조합원",
              is_union: false,
            })
          }
          style={{
            background: "#F3F4F6",
            color: "#6B7280",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          + 사업소 인원추가
        </button>

      
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="이름 또는 사번으로 검색"
        style={{
          width: "100%",
          padding: "11px 14px",
          borderRadius: 10,
          border: "1.5px solid #E5E7EB",
          fontSize: 14,
          outline: "none",
          boxSizing: "border-box",
          fontFamily: "inherit",
          marginBottom: 12,
        }}
      />

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
  <div onClick={() => setUnionFilter(unionFilter === "조합원" ? "전체" : "조합원")} style={{ flex: 1, background: "#EEF0FF", borderRadius: 10, padding: "10px 12px", textAlign: "center", cursor: "pointer", border: unionFilter === "조합원" ? "2px solid #4F46E5" : "2px solid transparent" }}>
    <div style={{ fontSize: 11, color: "#6B7280" }}>조합원</div>
    <div style={{ fontSize: 18, fontWeight: 800, color: "#4F46E5" }}>
      {members.filter((m) => m.is_union === true).length}명
    </div>
  </div>
  <div onClick={() => setUnionFilter(unionFilter === "비조합원" ? "전체" : "비조합원")} style={{ flex: 1, background: "#F3F4F6", borderRadius: 10, padding: "10px 12px", textAlign: "center", cursor: "pointer", border: unionFilter === "비조합원" ? "2px solid #9CA3AF" : "2px solid transparent" }}>
    <div style={{ fontSize: 11, color: "#6B7280" }}>비조합원</div>
    <div style={{ fontSize: 18, fontWeight: 800, color: "#9CA3AF" }}>
            {members.filter((m) => m.is_union !== true && !(m.name || "").includes("결원")).length}명
    </div>
  </div>
</div>

{filtered.map((m) => (
        <div
          key={m.id}
          style={{
            background: "#fff",
            borderRadius: 14,
            padding: "14px 16px",
            marginBottom: 8,
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 2,
                }}
              >
                <span
                  style={{ fontSize: 15, fontWeight: 700, color: "#1F2937" }}
                >
                  {m.name}
                </span>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>{m.role}</span>
                {m.is_admin && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#fff",
                      background: "#6D28D9",
                      borderRadius: 4,
                      padding: "1px 6px",
                    }}
                  >
                    관리자
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                사번 {m.employee_number} · {m.phone}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button
              onClick={() => toggleAdmin(m)}
              style={{
                flex: 1,
                padding: "7px",
                borderRadius: 6,
                border: "none",
                background: m.is_admin ? "#F3E8FF" : "#F3F4F6",
                color: m.is_admin ? "#6D28D9" : "#6B7280",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {m.is_admin ? "관리자✓" : "관리자"}
            </button>
            <button
              onClick={() => setForm(m)}
              style={{
                flex: 1,
                padding: "7px",
                borderRadius: 6,
                border: "none",
                background: "#F3F4F6",
                color: "#6B7280",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              수정
            </button>
            <button
              onClick={() => setDeleteTarget(m)}
              style={{
                flex: 1,
                padding: "7px",
                borderRadius: 6,
                border: "none",
                background: "#FEE2E2",
                color: "#EF4444",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              삭제
            </button>
          </div>
          <button
            onClick={() => handleResetPw(m)}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "7px",
              borderRadius: 6,
              border: "1px solid #FCD34D",
              background: "#FFFBEB",
              color: "#B45309",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            🔑 비밀번호 초기화 (union0000)
          </button>
        </div>
      ))}

      {filtered.length === 0 && (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "#9CA3AF",
            fontSize: 14,
          }}
        >
          검색 결과가 없습니다
        </div>
      )}

      {form && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setForm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "24px 20px",
              width: "100%",
              maxWidth: 360,
            }}
          >
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: "#1F2937",
                marginBottom: 18,
              }}
            >
              {form.id ? "조합원 수정" : "조합원 추가"}
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
              이름
            </div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="이름"
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                marginBottom: 14,
              }}
            />
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
              사번
            </div>
            <input
              value={form.employee_number}
              onChange={(e) =>
                setForm({ ...form, employee_number: e.target.value })
              }
              placeholder="사번"
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                marginBottom: 14,
              }}
            />
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
              전화번호
            </div>
            <input
              value={form.phone || ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="010-0000-0000"
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                marginBottom: 14,
              }}
            />
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 6 }}>
              직책
            </div>
            <input
              value={form.role || ""}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              placeholder="예: 조합원, 대의원, 지회장"
              style={{
                width: "100%",
                padding: "11px 12px",
                borderRadius: 10,
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                marginBottom: 20,
              }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, cursor: "pointer" }}>
  <input
    type="checkbox"
    checked={form.is_union === true}
    onChange={(e) => setForm({ ...form, is_union: e.target.checked })}
    style={{ width: 18, height: 18 }}
  />
  <span style={{ fontSize: 14, color: "#1F2937" }}>조합원 (체크 해제 시 비조합원)</span>
</label>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setForm(null)}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  background: "#fff",
                  color: "#6B7280",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                취소
              </button>
              <button
                onClick={handleSave}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: 20,
          }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "24px 20px",
              width: "100%",
              maxWidth: 320,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "#FEE2E2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: 26,
              }}
            >
              ⚠️
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "#1F2937",
                marginBottom: 8,
              }}
            >
              조합원 삭제
            </div>
            <div
              style={{
                fontSize: 14,
                color: "#6B7280",
                lineHeight: 1.6,
                marginBottom: 20,
              }}
            >
              <strong style={{ color: "#1F2937" }}>{deleteTarget.name}</strong>{" "}
              (사번 {deleteTarget.employee_number}) 조합원을
              <br />
              명단에서 삭제할까요?
              <br />
              <span style={{ fontSize: 12, color: "#EF4444" }}>
                삭제하면 되돌릴 수 없습니다.
              </span>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setDeleteTarget(null)}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  background: "#fff",
                  color: "#6B7280",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                취소
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 10,
                  border: "none",
                  background: "#EF4444",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function PaySettingScreen() {
  const [rows, setRows] = React.useState([]);
  const [saveMsg, setSaveMsg] = React.useState("");
  const [rates, setRates] = React.useState<any>(null);

  React.useEffect(() => {
    const loadRates = async () => {
      const { data } = await supabase
        .from("deduction_rates")
        .select("*")
        .order("year", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        const pct = (v) => (Number(v) * 100).toFixed(3).replace(/\.?0+$/, "");
        setRates({
          ...data,
          national_pension_pct: pct(data.national_pension),
          health_insurance_pct: pct(data.health_insurance),
          long_term_care_pct: pct(data.long_term_care),
          employment_insurance_pct: pct(data.employment_insurance),
          income_tax_pct: pct(data.income_tax),
          local_tax_pct: pct(data.local_tax),
          union_fee_pct: pct(data.union_fee),
        });
      };
    };
    loadRates();
  }, []);

  const rateField = (key, val, onChange) => (
    <input
      type="number"
      step="0.001"
      value={val ?? 0}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: 80,
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid #E5E7EB",
        fontSize: 14,
        textAlign: "right",
      }}
    />
  );

  const updateRate = (field, value) => {
    setRates((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveRates = async () => {
    if (!rates) return;
    const toNum = (v) => Number(v) / 100;
    await supabase
      .from("deduction_rates")
      .update({
        national_pension: toNum(rates.national_pension_pct),
        health_insurance: toNum(rates.health_insurance_pct),
        long_term_care: toNum(rates.long_term_care_pct),
        employment_insurance: toNum(rates.employment_insurance_pct),
        income_tax: toNum(rates.income_tax_pct),
        local_tax: toNum(rates.local_tax_pct),
        union_fee: toNum(rates.union_fee_pct),
      })
      .eq("id", rates.id);
    setSaveMsg("✅ 요율 저장됐어요!");
    setTimeout(() => setSaveMsg(""), 2500);
  };

  React.useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("worktype_pay_settings")
        .select("*")
        .order("work_type");
      if (data) setRows(data);
    };
    load();
  }, []);

  const updateField = (workType, field, value) => {
    setRows((prev) =>
      prev.map((r) =>
        r.work_type === workType ? { ...r, [field]: value } : r
      )
    );
  };

  const handleSave = async () => {
    for (const r of rows) {
      await supabase
        .from("worktype_pay_settings")
        .update({
          night_hours: Number(r.night_hours) || 0,
          holiday_day_hours: Number(r.holiday_day_hours) || 0,
          updated_at: new Date().toISOString(),
        })
        .eq("work_type", r.work_type);
    }
    setSaveMsg("✅ 저장됐어요!");
    setTimeout(() => setSaveMsg(""), 2500);
  };

  const numInput = (val, onChange) => (
    <input
      type="number"
      value={val ?? 0}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: 64,
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid #E5E7EB",
        fontSize: 14,
        textAlign: "right",
      }}
    />
  );

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#1F2937", marginBottom: 6 }}>
        급여시간 설정
      </div>
      <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>
        근무형태별 인정 시간(1회 기준)을 입력하세요. 야간 = 22~06시.
      </div>
      {rows.map((r) => (
        <div
          key={r.work_type}
          style={{
            background: "#fff",
            borderRadius: 14,
            padding: "14px 16px",
            marginBottom: 10,
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
            {r.work_type}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 13, color: "#6B7280" }}>🌙 야간시간</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {numInput(r.night_hours, (v) => updateField(r.work_type, "night_hours", v))}
              <span style={{ fontSize: 13, color: "#9CA3AF" }}>시간</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 13, color: "#6B7280" }}>☀️ 주간시간</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {numInput(r.holiday_day_hours, (v) => updateField(r.work_type, "holiday_day_hours", v))}
              <span style={{ fontSize: 13, color: "#9CA3AF" }}>시간</span>
            </div>
          </div>
        </div>
      ))}
      <button
        onClick={handleSave}
        style={{
          width: "100%",
          marginTop: 12,
          padding: "14px",
          borderRadius: 12,
          border: "none",
          background: "#4F46E5",
          color: "#fff",
          fontSize: 15,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        저장
      </button>
      {saveMsg && (
        <div style={{ textAlign: "center", marginTop: 10, fontSize: 14, color: "#10B981" }}>
          {saveMsg}
        </div>
      )}

      <div style={{ fontSize: 18, fontWeight: 800, color: "#1F2937", margin: "28px 0 6px" }}>
        공제 요율 설정
      </div>
      <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 14 }}>
        % 단위로 입력 (예: 4.75) · {rates?.year ?? ""}년 기준
      </div>
      {rates ? (
        <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 8px rgba(79,70,229,0.06)" }}>
          {[
            ["국민연금", "national_pension_pct"],
            ["건강보험", "health_insurance_pct"],
            ["장기요양 (건보료 대비)", "long_term_care_pct"],
            ["고용보험", "employment_insurance_pct"],
            ["소득세", "income_tax_pct"],
            ["지방소득세 (소득세 대비)", "local_tax_pct"],
            ["조합비 (기본급 대비)", "union_fee_pct"],
          ].map(([label, key]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#6B7280" }}>{label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {rateField(key, rates[key], (v) => updateRate(key, v))}
                <span style={{ fontSize: 13, color: "#9CA3AF" }}>%</span>
              </div>
            </div>
          ))}
          <button
            onClick={handleSaveRates}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "12px",
              background: "#4F46E5",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            요율 저장
          </button>
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: 30, color: "#9CA3AF" }}>요율 불러오는 중…</div>
      )}
    </div>
  );
}
function PointRankingAdmin() {
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    (async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data: pts } = await supabase
        .from("user_points")
        .select("employee_number, point")
        .gte("created_at", monthStart);
      const { data: mem } = await supabase
        .from("members")
        .select("employee_number, name");
      const nameMap: any = {};
      (mem || []).forEach((m: any) => { nameMap[String(m.employee_number)] = m.name; });
      const sums: any = {};
      (pts || []).forEach((r: any) => {
        const k = String(r.employee_number);
        sums[k] = (sums[k] || 0) + (r.point || 0);
      });
      const ranked = Object.entries(sums)
        .map(([emp, total]) => ({ emp, name: nameMap[emp] || "(미등록)", total: total as number }))
        .sort((a, b) => b.total - a.total);
      setRows(ranked);
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#1F2937", marginBottom: 4 }}>🏆 이번 달 포인트 순위</div>
      <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>매월 1일 초기화 · 실명 표시 (관리자 전용)</div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>이번 달 집계된 활동이 없어요</div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 8px rgba(79,70,229,0.06)" }}>
          {rows.map((r, i) => (
            <div key={r.emp} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: i < rows.length - 1 ? "1px solid #F3F4F6" : "none", background: i < 3 ? "#FFFBEB" : "#fff" }}>
              <span style={{ fontSize: 16, fontWeight: 800, width: 28, textAlign: "center" }}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1F2937" }}>{r.name}</span>
              <span style={{ fontSize: 12, color: "#9CA3AF", marginRight: 8 }}>{r.emp}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: "#4F46E5" }}>{r.total}P</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function FieldRegister() {
  const [title, setTitle] = React.useState("");
  const [date, setDate] = React.useState("");
  const [point, setPoint] = React.useState("");
  const [members, setMembers] = React.useState<any[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [doneMsg, setDoneMsg] = React.useState("");
  const [partSearch, setPartSearch] = React.useState("");

  React.useEffect(() => {
    supabase.from("members").select("name, employee_number, is_union").then(({ data }) => {
      setMembers((data || []).filter((m: any) => m.is_union === true));
    });
  }, []);

  const toggle = (emp: string) => {
    setSelected((prev) => prev.includes(emp) ? prev.filter((x) => x !== emp) : [...prev, emp]);
  };
  const toggleAll = () => {
    if (selected.length === members.length) setSelected([]);
    else setSelected(members.map((m: any) => String(m.employee_number)));
  };

  const handleSave = async () => {
    if (!title.trim()) { alert("활동 이름을 입력하세요"); return; }
    if (!point || Number(point) <= 0) { alert("지급 포인트를 입력하세요"); return; }
    if (selected.length === 0) { alert("참여자를 선택하세요"); return; }
    setSaving(true);
    try {
      const { data: act, error } = await supabase
        .from("field_activities")
        .insert({ title: title.trim(), activity_date: date || null, point: Number(point) })
        .select()
        .single();
      if (error || !act) { alert("활동 등록 실패"); setSaving(false); return; }
      const partRows = selected.map((emp) => ({ activity_id: act.id, employee_number: emp }));
      await supabase.from("field_participants").insert(partRows);
      const pointRows = selected.map((emp) => ({
        employee_number: emp,
        action: "활동 참여",
        point: Number(point),
        ref: title.trim(),
      }));
      await supabase.from("user_points").insert(pointRows);
      setDoneMsg(`${selected.length}명에게 ${point}P 지급 완료!`);
      setTitle(""); setDate(""); setPoint(""); setSelected([]);
      setTimeout(() => setDoneMsg(""), 4000);
    } catch (e) {
      alert("오류가 발생했어요");
    }
    setSaving(false);
  };

  const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box" as const, WebkitAppearance: "none" as const, appearance: "none" as const };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 14 }}>참여자 전원에게 같은 포인트를 한 번에 지급</div>

      {doneMsg && (
        <div style={{ background: "#D1FAE5", color: "#065F46", borderRadius: 12, padding: "12px 14px", fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
          ✅ {doneMsg}
        </div>
      )}

      <div style={{ background: "#fff", border: "1px solid #F3F4F6", borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 5 }}>활동 이름</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 6월 2일 출근 선전전" style={{ ...inputStyle, marginBottom: 14 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 5 }}>날짜</div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ width: 110 }}>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 5 }}>지급 포인트</div>
            <input type="number" value={point} onChange={(e) => setPoint(e.target.value)} placeholder="50" style={inputStyle} />
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #F3F4F6", borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1F2937" }}>참여자 선택</span>
          <span style={{ fontSize: 12, color: "#4F46E5", cursor: "pointer" }} onClick={toggleAll}>
            {selected.length === members.length && members.length > 0 ? "전체 해제" : "전체 선택"} · {selected.length}명
          </span>
        </div>
       <input
          value={partSearch}
          onChange={(e) => setPartSearch(e.target.value)}
          placeholder="이름 또는 사번으로 검색"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", border: "1px solid #E5E7EB", borderRadius: 10, fontSize: 13, outline: "none", fontFamily: "inherit", marginBottom: 10 }}
        />
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {members
            .filter((m: any) => {
              const q = partSearch.trim();
              if (!q) return true;
              return (m.name || "").includes(q) || String(m.employee_number || "").includes(q);
            })
            .sort((a: any, b: any) => {
              const ka = /^[가-힣]/.test(a.name || "");
              const kb = /^[가-힣]/.test(b.name || "");
              if (ka && !kb) return -1;
              if (!ka && kb) return 1;
              return (a.name || "").localeCompare(b.name || "", "ko");
            })
            .map((m: any) => {
            const emp = String(m.employee_number);
            const on = selected.includes(emp);
            return (
              <div key={emp} onClick={() => toggle(emp)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #F3F4F6", cursor: "pointer" }}>
                <span style={{ width: 20, height: 20, borderRadius: 5, background: on ? "#4F46E5" : "#fff", border: on ? "none" : "1.5px solid #D1D5DB", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13 }}>{on ? "✓" : ""}</span>
                <span style={{ flex: 1, fontSize: 14, color: "#1F2937" }}>{m.name}</span>
                <span style={{ fontSize: 12, color: "#9CA3AF" }}>{emp}</span>
              </div>
            );
          })}
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: saving ? "#A5B4FC" : "#4F46E5", color: "#fff", fontSize: 15, fontWeight: 700, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
        {saving ? "지급 중…" : `${selected.length}명에게 ${point || 0}P 지급하기`}
      </button>
    </div>
  );
}

function FieldRanking() {
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openEmp, setOpenEmp] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
      const { data: parts } = await supabase
        .from("field_participants")
        .select("employee_number, activity_id, created_at")
        .gte("created_at", yearStart);
      const { data: acts } = await supabase
        .from("field_activities")
        .select("id, title, activity_date, point");
      const { data: mem } = await supabase
        .from("members")
        .select("employee_number, name");
      const nameMap: any = {};
      (mem || []).forEach((m: any) => { nameMap[String(m.employee_number)] = m.name; });
      const actMap: any = {};
      (acts || []).forEach((a: any) => { actMap[a.id] = a; });
      const byEmp: any = {};
      (parts || []).forEach((p: any) => {
        const k = String(p.employee_number);
        if (!byEmp[k]) byEmp[k] = { count: 0, total: 0, list: [] };
        const a = actMap[p.activity_id];
        byEmp[k].count += 1;
        byEmp[k].total += a ? (a.point || 0) : 0;
        if (a) byEmp[k].list.push(a);
      });
      const ranked = Object.entries(byEmp)
        .map(([emp, v]: any) => ({ emp, name: nameMap[emp] || "(미등록)", count: v.count, total: v.total, list: v.list.sort((x: any, y: any) => String(y.activity_date || "").localeCompare(String(x.activity_date || ""))) }))
        .sort((a, b) => b.total - a.total);
      setRows(ranked);
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 10 }}>올해 현장활동 참여가 많은 순 · 이름을 누르면 상세</div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>아직 현장활동 기록이 없어요</div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #F3F4F6" }}>
          {rows.map((r, i) => (
            <div key={r.emp} style={{ borderBottom: i < rows.length - 1 ? "1px solid #F3F4F6" : "none" }}>
              <div onClick={() => setOpenEmp(openEmp === r.emp ? null : r.emp)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", background: i < 3 ? "#FFFBEB" : "#fff", cursor: "pointer" }}>
                <span style={{ width: 26, textAlign: "center", fontSize: 15, fontWeight: 700 }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1F2937" }}>{r.name}</span>
                <span style={{ fontSize: 13, color: "#6B7280" }}>{r.count}회 · {r.total}P</span>
                <span style={{ fontSize: 12, color: "#9CA3AF", marginLeft: 6 }}>{openEmp === r.emp ? "▲" : "▼"}</span>
              </div>
              {openEmp === r.emp && (
                <div style={{ background: "#FAFAFA", padding: "4px 16px 12px" }}>
                  {r.list.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#9CA3AF", padding: "8px 0" }}>활동 정보 없음</div>
                  ) : r.list.map((a: any, j: number) => (
                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: j < r.list.length - 1 ? "1px solid #F0F0F0" : "none" }}>
                      <span style={{ flex: 1, fontSize: 13, color: "#374151" }}>{a.title}</span>
                      <span style={{ fontSize: 11, color: "#9CA3AF", marginRight: 8 }}>{a.activity_date || ""}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#4F46E5" }}>+{a.point}P</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldActivityAdmin() {
  const [tab, setTab] = React.useState("register");
  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#1F2937", marginBottom: 14 }}>🚩 현장활동</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab("register")} style={{ flex: 1, padding: 10, borderRadius: 8, border: tab === "register" ? "none" : "1px solid #E5E7EB", background: tab === "register" ? "#4F46E5" : "#fff", color: tab === "register" ? "#fff" : "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>활동 등록</button>
        <button onClick={() => setTab("ranking")} style={{ flex: 1, padding: 10, borderRadius: 8, border: tab === "ranking" ? "none" : "1px solid #E5E7EB", background: tab === "ranking" ? "#4F46E5" : "#fff", color: tab === "ranking" ? "#fff" : "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>참여 순위</button>
      </div>
      {tab === "register" && <FieldRegister />}
      {tab === "ranking" && <FieldRanking />}
    </div>
  );
}
function AdminScreen({ onBack, user, onNavigate }) {
  const [activeMenu, setActiveMenu] = useState("home");
  const [diaPhoto, setDiaPhoto] = useState(null);
  const [diaLoading, setDiaLoading] = useState(false);
  const [diaResult, setDiaResult] = useState(null);
    const [diaError, setDiaError] = useState("");
        const [diaList, setDiaList] = useState([]);
  const [csvRows, setCsvRows] = useState<any[]>([]);

  const [pendingMembers, setPendingMembers] = useState(dummyPendingMembers);

  // 공지 작성
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeContent, setNoticeContent] = useState("");
  const [noticeIsUrgent, setNoticeIsUrgent] = useState(false);
  const [noticeDone, setNoticeDone] = useState(false);

  // 식당메뉴 입력
  const [canteenStation, setCanteenStation] = useState("대공원");
  const [canteenMeal, setCanteenMeal] = useState("점심");
  const [canteenItems, setCanteenItems] = useState([
    { category: "주식", name: "" },
    { category: "국", name: "" },
    { category: "주찬", name: "" },
    { category: "부찬", name: "" },
    { category: "후식", name: "" },
  ]);
  const [canteenDone, setCanteenDone] = useState(false);
  const [canteenPhoto, setCanteenPhoto] = useState(null);
  const [canteenLoading, setCanteenLoading] = useState(false);
  const [canteenResult, setCanteenResult] = useState(null);
  const [canteenError, setCanteenError] = useState("");


  // 투표/설문 만들기
  const [voteType, setVoteType] = useState("투표");
  const [voteTitle, setVoteTitle] = useState("");
  const [voteDesc, setVoteDesc] = useState("");
  const [voteDeadline, setVoteDeadline] = useState("");
  const [voteOptions, setVoteOptions] = useState(["", ""]);
  const [voteDone, setVoteDone] = useState(false);

  const adminMenus = [
    {
      id: "field",
      label: "현장활동",
      icon: "M3 21V5a2 2 0 012-2h6l1 2h7a1 1 0 011 1v9a1 1 0 01-1 1h-7l-1-2H5",
      color: "#EC4899",
      bg: "#FCE7F3",
      badge: 0,
    },
  {
      id: "ranking",
      label: "포인트 순위",
      icon: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
      color: "#F59E0B",
      bg: "#FEF3C7",
      badge: 0,
    },
    {
      id: "memberlist",
      label: "조합원 명단",
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
      color: "#6D28D9",
      bg: "#F3E8FF",
      badge: 0,
    },
    {
      id: "workmanage",
      label: "교번근무 관리",
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
      color: "#4F46E5",
      bg: "#EEF2FF",
      badge: 0,
    },
    {
      id: "notice",
      label: "공지사항 작성",
      icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
      color: "#0EA5E9",
      bg: "#E0F2FE",
      badge: 0,
    },
    {
      id: "canteen",
      label: "식당메뉴 입력",
      icon: "M6 2v6a2 2 0 002 2v12M6 2C6 2 5 4 5 7s1 3 1 3M18 2v20M14 2v6a2 2 0 002 2",
      color: "#10B981",
      bg: "#D1FAE5",
      badge: 0,
    },
    {
      id: "vote",
      label: "투표·설문 만들기",
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
      color: "#F59E0B",
      bg: "#FEF3C7",
      badge: 0,
    },
    {
      id: "events",
      label: "경조사 관리",
      icon: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
      color: "#EC4899",
      bg: "#FCE7F3",
      badge: 0,
    },
    {
      id: "paysettings",
      label: "급여시간 설정",
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      color: "#7C3AED",
      bg: "#F3E8FF",
      badge: 0,
    },
    {
      id: "kyobundia",
      label: "다이아 입력",
      icon: "M9 17v-6h13M9 5h13M3 5h.01M3 11h.01M3 17h.01",
      color: "#0891B2",
      bg: "#CFFAFE",
      badge: 0,
    },
  ];

  const [tempPasswords, setTempPasswords] = useState({});

  const handleApprove = (id) => {
    const tempPw = generateTempPassword();
    setTempPasswords((prev) => ({ ...prev, [id]: tempPw }));
    setPendingMembers((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              status: "approved",
              password: tempPw,
              is_temp_password: true,
            }
          : m
      )
    );
    // Supabase 업데이트
    supabase
      .from("members")
      .update({ status: "approved", password: tempPw, is_temp_password: true })
      .eq("id", id)
      .then(() => {});
  };
  const handleBlock = (id) => {
    setPendingMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "blocked" } : m))
    );
  };
  const handleKick = (id) => {
    setPendingMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "kicked" } : m))
    );
  };

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #1E1B4B 0%, #3730A3 50%, #4F46E5 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <button
            onClick={
              activeMenu !== "home" ? () => setActiveMenu("home") : onBack
            }
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              대공원승무지회
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              관리자 페이지
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 4,
              }}
            >
              ⚙️{" "}
              <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                {user?.name} 관리자
              </span>
            </div>
          </div>
        </div>
        {pendingMembers.filter((m) => m.status === "pending").length < 0 && (
          <div
            style={{
              background: "rgba(239,68,68,0.2)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 12,
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#EF4444",
              }}
            />
            <span style={{ fontSize: 13, color: "#fff" }}>
              가입 승인 대기{" "}
              <strong style={{ color: "#FCA5A5" }}>
                {pendingMembers.filter((m) => m.status === "pending").length}명
              </strong>
            </span>
          </div>
        )}
      </div>

      <div style={{ padding: "12px 16px 0" }}>
        {activeMenu === "home" && (
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
          >
            {adminMenus.map((menu) => (
              <div
                key={menu.id}
                onClick={() => {
                  if (menu.id === "events") {
                    onNavigate("events-admin");
                  } else if (menu.id === "notice") {
                    onNavigate("notice-admin");
                  } else {
                    setActiveMenu(menu.id);
                  }
                }}
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  padding: "20px 16px",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                  position: "relative",
                }}
              >
                {menu.badge > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      right: 12,
                      background: "#EF4444",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      borderRadius: "50%",
                      width: 20,
                      height: 20,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {menu.badge}
                  </div>
                )}
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: menu.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <Icon path={menu.icon} color={menu.color} size={24} />
                </div>
                <div
                  style={{ fontSize: 14, fontWeight: 700, color: "#1F2937" }}
                >
                  {menu.label}
                </div>
              </div>
            ))}
          </div>
        )}
        {activeMenu === "ranking" && <PointRankingAdmin />}
        {activeMenu === "field" && <FieldActivityAdmin />}
        {activeMenu === "workmanage" && <WorkManageScreen />}
        {activeMenu === "memberlist" && <MemberManageScreen />}
        {activeMenu === "paysettings" && <PaySettingScreen />}
        {activeMenu === "members" && (
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 800,
                color: "#1F2937",
                marginBottom: 12,
              }}
            >
              가입 신청 목록
            </div>
            {pendingMembers.map((m, i) => (
              <div
                key={m.id}
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  padding: "16px 20px",
                  marginBottom: 10,
                  boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: "#1F2937",
                        }}
                      >
                        {m.name}
                      </span>
                      <span
                        style={{
                          background:
                            m.status === "pending"
                              ? "#FEF3C7"
                              : m.status === "approved"
                              ? "#D1FAE5"
                              : "#FEE2E2",
                          color:
                            m.status === "pending"
                              ? "#F59E0B"
                              : m.status === "approved"
                              ? "#10B981"
                              : "#EF4444",
                          fontSize: 11,
                          fontWeight: 700,
                          borderRadius: 6,
                          padding: "2px 8px",
                        }}
                      >
                        {m.status === "pending"
                          ? "대기중"
                          : m.status === "approved"
                          ? "승인완료"
                          : "차단"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                      사번: {m.emp_id} · {m.work_type} · {m.date}
                    </div>
                    <div
                      style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}
                    >
                      {m.phone}
                    </div>
                  </div>
                </div>
                {m.status === "pending" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleApprove(m.id)}
                      style={{
                        flex: 1,
                        padding: "10px",
                        background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      ✅ 승인
                    </button>
                    <button
                      onClick={() => handleBlock(m.id)}
                      style={{
                        flex: 1,
                        padding: "10px",
                        background: "#FEE2E2",
                        color: "#EF4444",
                        border: "none",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      🚫 차단
                    </button>
                  </div>
                )}
                {m.status === "approved" && tempPasswords[m.id] && (
                  <div
                    style={{
                      background: "#D1FAE5",
                      borderRadius: 10,
                      padding: "10px 14px",
                      border: "1.5px solid #6EE7B7",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "#065F46",
                        marginBottom: 4,
                        fontWeight: 600,
                      }}
                    >
                      ✅ 승인 완료 · 임시 비밀번호
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 20,
                          fontWeight: 900,
                          color: "#059669",
                          letterSpacing: 3,
                        }}
                      >
                        {tempPasswords[m.id]}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(tempPasswords[m.id]);
                        }}
                        style={{
                          background: "#059669",
                          color: "#fff",
                          border: "none",
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        복사
                      </button>
                    </div>
                    <div
                      style={{ fontSize: 11, color: "#6B7280", marginTop: 6 }}
                    >
                      📱 조합원에게 이 비밀번호를 전달해주세요.
                      <br />첫 로그인 후 자동으로 변경 화면이 나타납니다.
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {activeMenu === "notice" &&
          (noticeDone ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 20px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: "#EEF0FF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <Icon
                  path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  color="#4F46E5"
                  size={40}
                />
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 8,
                }}
              >
                공지사항이 등록되었습니다!
              </div>
              <button
                onClick={() => {
                  setNoticeDone(false);
                  setNoticeTitle("");
                  setNoticeContent("");
                  setNoticeIsUrgent(false);
                }}
                style={{
                  marginTop: 20,
                  padding: "12px 32px",
                  background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                새 공지 작성
              </button>
            </div>
          ) : (
            <div>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  padding: "20px",
                  boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "#1F2937",
                    marginBottom: 16,
                  }}
                >
                  공지사항 작성
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                    background: noticeIsUrgent ? "#FEE2E2" : "#F8F7FF",
                    borderRadius: 12,
                    padding: "12px 16px",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: noticeIsUrgent ? "#EF4444" : "#6B7280",
                    }}
                  >
                    긴급공지로 설정
                  </span>
                  <button
                    onClick={() => setNoticeIsUrgent(!noticeIsUrgent)}
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      background: noticeIsUrgent ? "#EF4444" : "#E5E7EB",
                      position: "relative",
                      transition: "background 0.2s",
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "#fff",
                        position: "absolute",
                        top: 3,
                        left: noticeIsUrgent ? 23 : 3,
                        transition: "left 0.2s",
                      }}
                    />
                  </button>
                </div>
                <input
                  value={noticeTitle}
                  onChange={(e) => setNoticeTitle(e.target.value)}
                  placeholder="제목을 입력하세요"
                  style={{
                    width: "100%",
                    padding: "13px 0",
                    border: "none",
                    borderBottom: "1.5px solid #E5E7EB",
                    fontSize: 16,
                    fontWeight: 600,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#1F2937",
                    marginBottom: 16,
                  }}
                />
                <textarea
                  value={noticeContent}
                  onChange={(e) => setNoticeContent(e.target.value)}
                  placeholder="내용을 입력하세요"
                  rows={8}
                  style={{
                    width: "100%",
                    border: "none",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#374151",
                    lineHeight: 1.8,
                    resize: "none",
                  }}
                />
                <button
                  onClick={() => {
                    if (noticeTitle && noticeContent) setNoticeDone(true);
                  }}
                  style={{
                    width: "100%",
                    marginTop: 16,
                    padding: "14px",
                    background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  공지사항 등록
                </button>
              </div>
            </div>
          ))}
                  {activeMenu === "canteen" && (
  <div style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 8px rgba(79,70,229,0.06)" }}>
    <div style={{ fontSize: 15, fontWeight: 800, color: "#1F2937", marginBottom: 16 }}>식단표 사진 등록</div>
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 600, marginBottom: 8 }}>사업소</div>
      <div style={{ display: "flex", gap: 8 }}>
        {["대공원", "도봉", "신풍"].map((s) => (
          <button key={s} onClick={() => setCanteenStation(s)} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1.5px solid", borderColor: canteenStation === s ? "#4F46E5" : "#E5E7EB", background: canteenStation === s ? "#EEF0FF" : "#fff", color: canteenStation === s ? "#4F46E5" : "#6B7280", fontWeight: canteenStation === s ? 700 : 400, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>{s}</button>
        ))}
      </div>
    </div>
    <label style={{ display: "block", padding: "60px 16px", border: "2px dashed #C7D2FE", borderRadius: 12, textAlign: "center", cursor: "pointer", color: "#4F46E5", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
      {canteenPhoto ? "사진 다시 선택" : "📷 식단표 사진 선택"}
      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => { setCanteenPhoto(String(reader.result)); setCanteenResult(null); setCanteenError(""); };
        reader.readAsDataURL(f);
      }} />
    </label>
    {canteenPhoto && (
      <img src={canteenPhoto} alt="미리보기" style={{ width: "100%", borderRadius: 12, marginBottom: 12 }} />
    )}
    {canteenPhoto && !canteenResult && (
      <button disabled={canteenLoading} onClick={async () => {
        setCanteenLoading(true); setCanteenError("");
        try {
          const comma = canteenPhoto.indexOf(",");
          const meta = canteenPhoto.slice(5, canteenPhoto.indexOf(";"));
          const b64 = canteenPhoto.slice(comma + 1);
          const r = await fetch("/.netlify/functions/read-menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: b64, mediaType: meta }) });
          const d = await r.json();
          if (d.error) throw new Error(d.error);
          const txt = (d.text || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(txt);
          setCanteenResult(parsed.days || []);
        } catch (err) {
          setCanteenError("읽기 실패: " + String(err));
        }
        setCanteenLoading(false);
      }} style={{ width: "100%", padding: 14, background: canteenLoading ? "#9CA3AF" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        {canteenLoading ? "AI가 읽는 중..." : "AI로 메뉴 읽기"}
      </button>
    )}
    {canteenError && <div style={{ color: "#DC2626", fontSize: 13, marginTop: 10 }}>{canteenError}</div>}
    {canteenResult && (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1F2937", marginBottom: 10 }}>읽은 결과 (수정 가능)</div>
        {canteenResult.map((day, di) => (
          <div key={di} style={{ marginBottom: 12, border: "1px solid #E5E7EB", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 700, color: "#4F46E5", marginBottom: 6 }}>{day.day} {day.date}</div>
            {["breakfast", "lunch", "dinner"].map((mk) => (
              <div key={mk} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ width: 36, fontSize: 11, color: "#9CA3AF" }}>{mk === "breakfast" ? "아침" : mk === "lunch" ? "점심" : "저녁"}</span>
                <input value={day[mk] || ""} onChange={(e) => { const c = [...canteenResult]; c[di] = { ...c[di], [mk]: e.target.value }; setCanteenResult(c); }} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", color: "#1F2937" }} />
              </div>
            ))}
          </div>
        ))}
        <button onClick={async () => {
          setCanteenLoading(true);
          try {
            const _dates = canteenResult.map((d) => d.date || d.day).filter(Boolean);
await supabase.from("canteen").delete().eq("station", canteenStation).in("menu_date", _dates);
            const rows = [];
            canteenResult.forEach((day) => {
              [["breakfast", "아침"], ["lunch", "점심"], ["dinner", "저녁"]].forEach(([k, label]) => {
                if (day[k]) rows.push({ station: canteenStation, meal_type: label, items: [day[k]], menu_date: day.date || day.day });
              });
            });
            if (rows.length) await supabase.from("canteen").insert(rows);
            setCanteenDone(true); setCanteenPhoto(null); setCanteenResult(null);
          } catch (err) { setCanteenError("저장 실패: " + String(err)); }
          setCanteenLoading(false);
        }} style={{ width: "100%", marginTop: 8, padding: 14, background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          이대로 저장
        </button>
      </div>
    )}
  </div>
)}
        
{activeMenu === "kyobundia" && (
  <div style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 8px rgba(79,70,229,0.06)" }}>
    <div style={{ fontSize: 15, fontWeight: 800, color: "#1F2937", marginBottom: 16 }}>교번 다이아 시간표 등록 (여러 장)</div>
        {/* ===== 엑셀(CSV) 한 번에 업로드 ===== */}
    <label style={{ display: "block", padding: 16, border: "2px dashed #6EE7B7", borderRadius: 12, textAlign: "center", cursor: "pointer", color: "#059669", fontSize: 14, fontWeight: 700, marginBottom: 8, background: "#F0FDF4" }}>
            📄 엑셀 또는 CSV 파일로 한 번에 올리기
            <input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }} onChange={(e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        setDiaError("");
                const parseRows = (header: string[], dataRows: string[][]) => {
          const col: any = {};
          header.forEach((h, i) => { col[String(h).trim()] = i; });
          const toH = (v: any) => {
            const s = String(v || "").trim();
            if (s.includes(":")) { const p = s.split(":").map(Number); return Math.round(((p[0] || 0) + (p[1] || 0) / 60 + (p[2] || 0) / 3600) * 100) / 100; }
            return Number(s) || 0;
          };
          const hhmm = (v: any) => { const s = String(v || "").trim(); const p = s.split(":"); return p.length >= 2 ? p[0].padStart(2, "0") + ":" + p[1].padStart(2, "0") : s; };
          const g = (c: string[], name: string) => c[col[name]] ?? "";
          const rows = dataRows.map((c) => ({
            dia_no: Number(g(c, "근무번호")) || 0,
            day_type: String(g(c, "일자형태") || ""),
            start_time: hhmm(g(c, "출근시간")),
            end_time: hhmm(g(c, "퇴근시간")),
            work_hours: toH(g(c, "근무시간")),
            drive_hours: toH(g(c, "운전시간")),
            prep_hours: toH(g(c, "준비시간")),
            ride_hours: toH(g(c, "편승시간")),
            wait_hours: toH(g(c, "대기시간")),
            clean_hours: toH(g(c, "정리시간")),
            watch_hours: toH(g(c, "감시시간")),
            night_hours: toH(g(c, "심야시간")),
            edu_hours: toH(g(c, "교육시간")),
            distance_km: Number(g(c, "주행거리")) || 0,
            photo: "",
          })).filter((r) => r.dia_no > 0);
          setCsvRows(rows);
        };
        const name = (f.name || "").toLowerCase();
        if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
          const ensureXLSX = () => new Promise<any>((resolve, reject) => {
            if ((window as any).XLSX) return resolve((window as any).XLSX);
            const s = document.createElement("script");
            s.src = "https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js";
            s.onload = () => resolve((window as any).XLSX);
            s.onerror = () => reject(new Error("엑셀 도구 로드 실패"));
            document.body.appendChild(s);
          });
          ensureXLSX().then((XLSX) => {
            const fr = new FileReader();
            fr.onload = (ev) => {
              try {
                const data = new Uint8Array(ev.target!.result as ArrayBuffer);
                const wb = XLSX.read(data, { type: "array" });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
                const header = (aoa[0] || []).map((h: any) => String(h));
                parseRows(header, aoa.slice(1).map((r) => r.map((c: any) => (c == null ? "" : String(c)))));
              } catch (err) { setDiaError("엑셀 읽기 실패: " + String(err)); }
            };
            fr.readAsArrayBuffer(f);
          }).catch((err) => setDiaError(String(err)));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const text = String(reader.result || "");
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            const header = lines[0].split(",").map((h) => h.trim());
            parseRows(header, lines.slice(1).map((line) => line.split(",")));

           
          } catch (err) { setDiaError("CSV 읽기 실패: " + String(err)); }
        };
        reader.readAsText(f, "utf-8");
      }} />
    </label>

    {csvRows.length > 0 && (
      <div style={{ marginBottom: 16, padding: 12, background: "#F0FDF4", borderRadius: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#065F46", marginBottom: 8 }}>
          {csvRows.length}개 다이아 읽음 ({csvRows[0]?.day_type})
        </div>
        <div style={{ fontSize: 12, color: "#047857", marginBottom: 10, maxHeight: 120, overflowY: "auto" }}>
          {csvRows.map((r, i) => (
            <div key={i}>{r.dia_no}번 · {r.start_time}~{r.end_time} · {r.work_hours}h</div>
          ))}
        </div>
        <button disabled={diaLoading} onClick={async () => {
          setDiaLoading(true); setDiaError("");
          try {
            const { error } = await supabase.from("kyobun_dia").upsert(csvRows);
            if (error) throw new Error(error.message);
            alert(csvRows.length + "개 저장 완료!");
            setCsvRows([]);
          } catch (err) { setDiaError("저장 실패: " + String(err)); }
          setDiaLoading(false);
        }} style={{ width: "100%", padding: 14, background: diaLoading ? "#9CA3AF" : "linear-gradient(135deg,#10B981,#059669)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          {diaLoading ? "저장 중..." : "전부 저장 (" + csvRows.length + "개)"}
        </button>
      </div>
    )}
    {/* ===== 엑셀 업로드 끝 ===== */}

    <label style={{ display: "block", padding: 16, border: "2px dashed #C7D2FE", borderRadius: 12, textAlign: "center", cursor: "pointer", color: "#4F46E5", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
      📷 다이아 사진 여러 장 선택
      <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setDiaError(""); setDiaList([]);
        let loaded = 0;
        const arr = new Array(files.length);
        files.forEach((f, i) => {
          const reader = new FileReader();
          reader.onload = () => {
            arr[i] = { photo: String(reader.result), result: null, day_type: "평일", status: "대기" };
            loaded++;
            if (loaded === files.length) setDiaList([...arr]);
          };
          reader.readAsDataURL(f);
        });
      }} />
    </label>

    {diaList.length > 0 && (
      <button disabled={diaLoading} onClick={async () => {
        setDiaLoading(true); setDiaError("");
        const next = [...diaList];
        for (let i = 0; i < next.length; i++) {
          if (next[i].result) continue;
          next[i].status = "읽는중";
          setDiaList([...next]);
          try {
            const photo = next[i].photo;
            const comma = photo.indexOf(",");
            const meta = photo.slice(5, photo.indexOf(";"));
            const b64 = photo.slice(comma + 1);
            const r = await fetch("/.netlify/functions/read-dia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: b64, mediaType: meta }) });
            const d = await r.json();
            if (d.error) throw new Error(d.error);
            const txt = (d.text || "").replace(/```json|```/g, "").trim();
            next[i].result = JSON.parse(txt);
            next[i].status = "완료";
          } catch (err) {
            next[i].status = "실패";
          }
          setDiaList([...next]);
        }
        setDiaLoading(false);
      }} style={{ width: "100%", padding: 14, marginBottom: 12, background: diaLoading ? "#9CA3AF" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        {diaLoading ? "AI가 읽는 중..." : "전부 AI로 읽기 (" + diaList.length + "장)"}
      </button>
    )}

    {diaError && <div style={{ color: "#DC2626", fontSize: 13, marginBottom: 10 }}>{diaError}</div>}

    {diaList.map((item, i) => (
      <div key={i} style={{ border: "1px solid #E5E7EB", borderRadius: 12, padding: 12, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <img src={item.photo} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1F2937" }}>
              {item.result ? "다이아 " + (item.result.dia_no ?? "?") + "번" : "사진 " + (i + 1)}
            </div>
            <div style={{ fontSize: 12, color: item.status === "실패" ? "#DC2626" : item.status === "완료" ? "#059669" : "#6B7280" }}>{item.status}</div>
          </div>
        </div>
        {item.result && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["평일", "휴일", "평평", "평휴", "휴휴", "휴평"].map((d) => {
              const on = item.day_type === d;
              return (
                <button key={d} onClick={() => { const n = [...diaList]; n[i].day_type = d; setDiaList(n); }} style={{ padding: "6px 12px", borderRadius: 100, border: on ? "none" : "1px solid #E5E7EB", background: on ? "linear-gradient(135deg,#4F46E5,#6366F1)" : "#fff", color: on ? "#fff" : "#6B7280", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{d}</button>
              );
            })}
          </div>
        )}
      </div>
    ))}

    {diaList.some((x) => x.result) && (
      <button disabled={diaLoading} onClick={async () => {
        setDiaLoading(true); setDiaError("");
        try {
          const toH = (v) => {
            const s = String(v || "").trim();
            if (s.includes(":")) { const p = s.split(":").map(Number); return Math.round(((p[0] || 0) + (p[1] || 0) / 60 + (p[2] || 0) / 3600) * 100) / 100; }
            return Number(s) || 0;
          };
          const rows = diaList.filter((x) => x.result).map((x) => ({
            dia_no: Number(x.result.dia_no) || 0,
            day_type: String(x.day_type || "평일"),
            distance_km: Number(x.result.distance_km) || 0,
            start_time: String(x.result.start_time || ""),
            work_hours: toH(x.result.work_hours),
            drive_hours: toH(x.result.drive_hours),
            wait_hours: toH(x.result.wait_hours),
            ride_hours: toH(x.result.ride_hours),
            watch_hours: toH(x.result.watch_hours),
            edu_hours: toH(x.result.edu_hours),
            prep_hours: toH(x.result.prep_hours),
            clean_hours: toH(x.result.clean_hours),
            night_hours: toH(x.result.night_hours),
            photo: x.photo || "",
          }));
          const { error } = await supabase.from("kyobun_dia").upsert(rows);
          if (error) throw new Error(error.message);
          alert(rows.length + "개 저장 완료!");
          setDiaList([]);
        } catch (err) { setDiaError("저장 실패: " + String(err)); }
        setDiaLoading(false);
      }} style={{ width: "100%", marginTop: 8, padding: 14, background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        전부 저장 ({diaList.filter((x) => x.result).length}개)
      </button>
    )}
  </div>
)}
        {activeMenu === "vote" &&
          (voteDone ? (

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 20px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: "#FEF3C7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                <Icon
                  path="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  color="#F59E0B"
                  size={40}
                />
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 8,
                }}
              >
                {voteType}가 등록되었습니다!
              </div>
              <button
                onClick={() => {
                  setVoteDone(false);
                  setVoteTitle("");
                  setVoteDesc("");
                  setVoteDeadline("");
                  setVoteOptions(["", ""]);
                }}
                style={{
                  marginTop: 20,
                  padding: "12px 32px",
                  background: "linear-gradient(135deg, #F59E0B, #D97706)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                새로 만들기
              </button>
            </div>
          ) : (
            <div>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  padding: "20px",
                  boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: "#1F2937",
                    marginBottom: 16,
                  }}
                >
                  투표/설문 만들기
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {["투표", "설문"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setVoteType(t)}
                      style={{
                        flex: 1,
                        padding: "12px",
                        borderRadius: 10,
                        border: "1.5px solid",
                        borderColor: voteType === t ? "#F59E0B" : "#E5E7EB",
                        background: voteType === t ? "#FEF3C7" : "#fff",
                        color: voteType === t ? "#F59E0B" : "#6B7280",
                        fontWeight: voteType === t ? 700 : 400,
                        fontSize: 14,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input
                  value={voteTitle}
                  onChange={(e) => setVoteTitle(e.target.value)}
                  placeholder="제목을 입력하세요"
                  style={{
                    width: "100%",
                    padding: "13px 0",
                    border: "none",
                    borderBottom: "1.5px solid #E5E7EB",
                    fontSize: 15,
                    fontWeight: 600,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#1F2937",
                    marginBottom: 14,
                  }}
                />
                <input
                  value={voteDesc}
                  onChange={(e) => setVoteDesc(e.target.value)}
                  placeholder="설명을 입력하세요"
                  style={{
                    width: "100%",
                    padding: "13px 0",
                    border: "none",
                    borderBottom: "1.5px solid #E5E7EB",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#374151",
                    marginBottom: 14,
                  }}
                />
                <input
                  type="date"
                  value={voteDeadline}
                  onChange={(e) => setVoteDeadline(e.target.value)}
                  placeholder="마감일 (예: 2024.06.01)"
                  style={{
                    width: "100%",
                    padding: "13px 0",
                    border: "none",
                    borderBottom: "1.5px solid #E5E7EB",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#374151",
                    marginBottom: 16,
                  }}
                />
                <div
                  style={{
                    fontSize: 12,
                    color: "#9CA3AF",
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  선택지
                </div>
                {voteOptions.map((opt, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: "#FEF3C7",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#F59E0B",
                        }}
                      >
                        {i + 1}
                      </span>
                    </div>
                    <input
                      value={opt}
                      onChange={(e) => {
                        const updated = [...voteOptions];
                        updated[i] = e.target.value;
                        setVoteOptions(updated);
                      }}
                      placeholder={`선택지 ${i + 1}`}
                      style={{
                        flex: 1,
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1.5px solid #E5E7EB",
                        fontSize: 14,
                        outline: "none",
                        fontFamily: "inherit",
                        color: "#1F2937",
                      }}
                    />
                    {voteOptions.length > 2 && (
                      <button
                        onClick={() =>
                          setVoteOptions(
                            voteOptions.filter((_, idx) => idx !== i)
                          )
                        }
                        style={{
                          background: "#FEE2E2",
                          border: "none",
                          borderRadius: 8,
                          width: 32,
                          height: 32,
                          color: "#EF4444",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontSize: 16,
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setVoteOptions([...voteOptions, ""])}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "#F8F7FF",
                    color: "#4F46E5",
                    border: "1.5px dashed #C7D2FE",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    marginBottom: 16,
                  }}
                >
                  + 선택지 추가
                </button>
                <button
                  onClick={() => {
                    if (
                      !voteTitle ||
                      voteOptions.filter((o) => o.trim()).length < 2
                    )
                      return;
                    const newVote = {
                      type: voteType,
                      title: voteTitle,
                      description: voteDesc,
                      status: "진행중",
                      deadline: voteDeadline || null,
                      total_members: 0,
                      options: voteOptions.filter((o) => o.trim()),
                    };
                    supabase
                      .from("votes")
                      .insert([newVote])
                      .then(({ error }) => {
                        if (!error) {
                          setVoteDone(true);
                          setVoteTitle("");
                          setVoteDesc("");
                          setVoteDeadline("");
                          setVoteOptions(["", ""]);
                        }
                      });
                  }}
                  style={{
                    width: "100%",
                    padding: "14px",
                    background: "linear-gradient(135deg, #F59E0B, #D97706)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {voteType} 등록
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── 내설정 ──
// ── 포인트 시스템 ──
// 사용자 ID 추출 헬퍼
function getUserId(user) {
  return String(user?.emp_id || user?.id || "guest");
}

const POINT_RULES = {
  access: { label: "앱 접속", point: 5, maxPerDay: 1 },
  checkin: { label: "출석 체크", point: 10, maxPerDay: 1 },
  notice: { label: "공지사항 읽기", point: 3, maxPerDay: 5 },
  schedule: { label: "근무표 확인", point: 3, maxPerDay: 1 },
  vote: { label: "투표·설문 참여", point: 20, maxPerDay: 3 },
  post: { label: "게시글 작성", point: 15, maxPerDay: 3 },
  comment: { label: "댓글 작성", point: 5, maxPerDay: 10 },
};

function getPointKey(empId) {
  return `points_${String(empId)}`;
}
function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadPointData(empId) {
  try {
    const raw = localStorage.getItem(getPointKey(empId));
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { total: 0, logs: [], todayActions: {} };
}

function savePointData(empId, data) {
  try {
    localStorage.setItem(getPointKey(empId), JSON.stringify(data));
  } catch (e) {}
}

async function addPoint(empId, actionKey, ref?) {
  if (!POINT_RULES[actionKey]) return null;
  const rule = POINT_RULES[actionKey];

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    if (actionKey === "notice" && ref) {
      const { data } = await supabase
        .from("user_points")
        .select("id")
        .eq("employee_number", String(empId))
        .eq("action", rule.label)
        .eq("ref", String(ref))
        .limit(1);
      if (data && data.length > 0) return null;
    } else {
      const { data } = await supabase
        .from("user_points")
        .select("id")
        .eq("employee_number", String(empId))
        .eq("action", rule.label)
        .gte("created_at", todayStart.toISOString());
      if (data && data.length >= rule.maxPerDay) return null;
    }

    await supabase.from("user_points").insert({
      employee_number: String(empId),
      action: rule.label,
      point: rule.point,
      ref: ref ? String(ref) : null,
    });
  } catch (e) {
    return null;
  }

  try {
    const d = loadPointData(empId);
    d.total = (d.total || 0) + rule.point;
    if (!d.logs) d.logs = [];
    d.logs.unshift({
      date: new Date().toLocaleString("ko-KR"),
      action: rule.label,
      point: rule.point,
      total: d.total,
    });
    savePointData(empId, d);
  } catch (e) {}

  return rule.point;
}

// ── 비밀번호 변경 컴포넌트 ──
function PwChangeSection({ user }) {
  const [open, setOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPwConfirm, setNewPwConfirm] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleChange = async () => {
    setError("");
    if (!curPw) {
      setError("현재 비밀번호를 입력해주세요.");
      return;
    }
    const pwErr2 = validatePassword(newPw);
    if (pwErr2) {
      setError(pwErr2);
      return;
    }
    if (newPw !== newPwConfirm) {
      setError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    if (curPw === newPw) {
      setError("현재 비밀번호와 다른 비밀번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("members")
      .select("password")
      .eq("employee_number", user?.emp_id)
      .single();
    if (!data || data.password !== curPw) {
      setLoading(false);
      setError("현재 비밀번호가 올바르지 않습니다.");
      return;
    }
    await supabase
      .from("members")
      .update({ password: newPw, is_temp_password: false })
      .eq("employee_number", user?.emp_id);
    setLoading(false);
    setDone(true);
    setCurPw("");
    setNewPw("");
    setNewPwConfirm("");
    setTimeout(() => {
      setDone(false);
      setOpen(false);
    }, 2000);
  };

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 20,
        padding: "20px",
        marginBottom: 12,
        boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: open ? 16 : 0,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: "#1F2937",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 4,
              height: 18,
              background: "#4F46E5",
              borderRadius: 2,
            }}
          />
          비밀번호 변경
        </div>
        <button
          onClick={() => {
            setOpen(!open);
            setError("");
            setDone(false);
          }}
          style={{
            background: open ? "#F3F4F6" : "#EEF0FF",
            color: open ? "#6B7280" : "#4F46E5",
            border: "none",
            borderRadius: 8,
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {open ? "닫기" : "변경하기"}
        </button>
      </div>
      {open && (
        <div>
          {done && (
            <div
              style={{
                background: "#D1FAE5",
                borderRadius: 12,
                padding: "12px 16px",
                marginBottom: 14,
                fontSize: 13,
                color: "#10B981",
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              ✅ 비밀번호가 변경되었습니다!
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 6 }}>
              현재 비밀번호
            </div>
            <div style={{ position: "relative" }}>
              <input
                value={curPw}
                onChange={(e) => {
                  setCurPw(e.target.value);
                  setError("");
                }}
                placeholder="현재 비밀번호 입력"
                type={showCur ? "text" : "password"}
                style={{
                  width: "100%",
                  padding: "12px 44px 12px 14px",
                  borderRadius: 12,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  color: "#1F2937",
                }}
              />
              <button
                onClick={() => setShowCur(!showCur)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#9CA3AF",
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
              >
                {showCur ? "숨김" : "표시"}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 6 }}>
              새 비밀번호{" "}
              <span style={{ fontSize: 11 }}>(영문+숫자 7자 이상)</span>
            </div>
            <div style={{ position: "relative" }}>
              <input
                value={newPw}
                onChange={(e) => {
                  setNewPw(e.target.value);
                  setError("");
                }}
                placeholder="새 비밀번호 입력"
                type={showNew ? "text" : "password"}
                style={{
                  width: "100%",
                  padding: "12px 44px 12px 14px",
                  borderRadius: 12,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  color: "#1F2937",
                }}
              />
              <button
                onClick={() => setShowNew(!showNew)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#9CA3AF",
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
              >
                {showNew ? "숨김" : "표시"}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 6 }}>
              새 비밀번호 확인
            </div>
            <input
              value={newPwConfirm}
              onChange={(e) => {
                setNewPwConfirm(e.target.value);
                setError("");
              }}
              placeholder="새 비밀번호 재입력"
              type="password"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: `1.5px solid ${
                  newPwConfirm && newPw !== newPwConfirm ? "#EF4444" : "#E5E7EB"
                }`,
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                color: "#1F2937",
              }}
            />
            {newPwConfirm && newPw === newPwConfirm && newPw.length >= 6 && (
              <div style={{ fontSize: 11, color: "#10B981", marginTop: 4 }}>
                ✅ 비밀번호 일치
              </div>
            )}
            {newPwConfirm && newPw !== newPwConfirm && (
              <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>
                비밀번호가 일치하지 않습니다
              </div>
            )}
          </div>
          {error && (
            <div
              style={{
                background: "#FEE2E2",
                color: "#EF4444",
                fontSize: 13,
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}
          <button
            onClick={handleChange}
            disabled={loading}
            style={{
              width: "100%",
              padding: "13px",
              background: loading
                ? "#A5B4FC"
                : "linear-gradient(135deg, #4F46E5, #6D28D9)",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {loading ? "변경 중..." : "비밀번호 변경하기"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 포인트 현황 컴포넌트 ──
function PointSection({ user }) {
  const empId = getUserId(user);
  const [pointData, setPointData] = React.useState(() => loadPointData(empId));
  const [showLogs, setShowLogs] = React.useState(false);
  const [toast, setToast] = React.useState("");
const [dbRows, setDbRows] = React.useState<any[]>([]);
  const loadDb = async () => {
    const { data } = await supabase
      .from("user_points")
      .select("action, point, created_at")
      .eq("employee_number", String(empId))
      .order("created_at", { ascending: false });
    setDbRows(data || []);
  };
  React.useEffect(() => {
    loadDb();
  }, [empId]);
  const today = getTodayStr();
 const todayCheckin = dbRows.filter((r: any) => {
    if (r.action !== "출석 체크") return false;
    const d = new Date(r.created_at);
    const n = new Date();
    return d.toDateString() === n.toDateString();
  }).length;

  const handleCheckin = async () => {
    if (user?.is_admin) { setToast("관리자는 포인트 대상이 아니에요"); setTimeout(() => setToast(""), 2000); return; }
    const earned = await addPoint(empId, "checkin");
    if (earned) {
      setToast(`+${earned}P 출석 체크 완료!`);
      setTimeout(() => setToast(""), 2000);
      loadDb();
    } else {
      setToast("오늘 이미 출석했어요!");
      setTimeout(() => setToast(""), 2000);
    }
  };

  const nowD = new Date();
  const curY = nowD.getFullYear();
  const curM = nowD.getMonth();

  const monthRows = dbRows.filter((r: any) => {
    const d = new Date(r.created_at);
    return d.getFullYear() === curY && d.getMonth() === curM;
  });
  const monthlyPoint = monthRows.reduce((s: number, r: any) => s + (r.point || 0), 0);
  const totalPoint = dbRows.reduce((s: number, r: any) => s + (r.point || 0), 0);

  const byType: any = {};
  monthRows.forEach((r: any) => {
    if (!byType[r.action]) byType[r.action] = { count: 0, point: 0 };
    byType[r.action].count += 1;
    byType[r.action].point += r.point || 0;
  });
  const byTypeArr = Object.entries(byType).sort((a: any, b: any) => b[1].point - a[1].point);
  const recentLogs = dbRows.slice(0, 5).map((r: any) => ({
    action: r.action,
    point: r.point,
    date: new Date(r.created_at).toLocaleString("ko-KR"),
  }));

  return (
    <div style={{ background: "#fff", borderRadius: 20, padding: 16, marginBottom: 12, boxShadow: "0 2px 8px rgba(79,70,229,0.06)" }}>
      {toast && (
        <div style={{ position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)", background: "#1F2937", color: "#fff", padding: "10px 18px", borderRadius: 20, fontSize: 14, zIndex: 9999 }}>
          {toast}
        </div>
      )}

      <div style={{ fontSize: 16, fontWeight: 800, color: "#1F2937", marginBottom: 14 }}>🏆 나의 포인트</div>

      <div style={{ background: "#F5F3FF", borderRadius: 16, padding: "20px 16px", textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: "#7C6FDA", marginBottom: 6 }}>이번 달 포인트</div>
        <div style={{ fontSize: 38, fontWeight: 800, color: "#4F46E5", lineHeight: 1 }}>
          {monthlyPoint}<span style={{ fontSize: 20 }}>P</span>
        </div>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 8 }}>매월 1일 집계 · 1등 상품 증정</div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F9FAFB", borderRadius: 12, padding: "11px 16px", marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "#6B7280" }}>누적 포인트</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1F2937" }}>{totalPoint}P</span>
      </div>

      <button
        onClick={handleCheckin}
        disabled={todayCheckin >= 1}
        style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", background: todayCheckin >= 1 ? "#E5E7EB" : "#10B981", color: todayCheckin >= 1 ? "#9CA3AF" : "#fff", fontSize: 15, fontWeight: 700, cursor: todayCheckin >= 1 ? "default" : "pointer", fontFamily: "inherit", marginBottom: 16 }}
      >
        {todayCheckin >= 1 ? "✅ 오늘 출석 완료 (+10P)" : "🙋 출석 체크 (+10P)"}
      </button>

      <div style={{ background: "#F9FAFB", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1F2937", marginBottom: 10 }}>이번 달 적립 내역</div>
        {byTypeArr.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: "8px 0" }}>이번 달 적립이 아직 없어요</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
           {byTypeArr.map(([label, info]: any) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "#374151" }}>{label} · {info.count}회</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#4F46E5" }}>+{info.point}P</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => setShowLogs(!showLogs)}
        style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #E5E7EB", background: "#fff", fontSize: 14, fontWeight: 600, color: "#4F46E5", cursor: "pointer", fontFamily: "inherit" }}
      >
        {showLogs ? "최근 활동 닫기 ▲" : "최근 활동 보기 ▼"}
      </button>

      {showLogs && (
        <div style={{ marginTop: 10 }}>
          {recentLogs.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "#9CA3AF" }}>아직 활동 내역이 없어요</div>
          ) : (
            recentLogs.map((log, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1F2937" }}>{log.action}</div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{log.date}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#10B981" }}>+{log.point}P</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ===== 근무표 화면 (ScheduleScreen) =====
// 순환표 데이터 - 검증 완료
const 대공원순환: string[] = [
  "4",
  "71",
  "71~",
  "휴1",
  "29",
  "67",
  "67~",
  "휴2",
  "대기1",
  "63",
  "63~",
  "휴3",
  "7",
  "74",
  "74~",
  "휴4",
  "13",
  "대기7",
  "휴5",
  "15",
  "79",
  "79~",
  "휴6",
  "26",
  "66",
  "66~",
  "휴7",
  "17",
  "휴71",
  "휴72",
  "휴8",
  "18",
  "69",
  "69~",
  "휴9",
  "1",
  "10",
  "휴10",
  "대기2",
  "62",
  "62~",
  "휴11",
  "8",
  "75",
  "75~",
  "휴12",
  "12",
  "72",
  "72~",
  "휴13",
  "27",
  "73",
  "73~",
  "휴14",
  "2",
  "대기5",
  "휴15",
  "19",
  "78",
  "78~",
  "휴16",
  "25",
  "대기62",
  "대기62~",
  "휴17",
  "대기3",
  "64",
  "64~",
  "휴18",
  "14",
  "77",
  "77~",
  "휴19",
  "5",
  "22",
  "휴20",
  "3",
  "76",
  "76~",
  "휴21",
  "28",
  "70",
  "70~",
  "휴22",
  "20",
  "68",
  "68~",
  "휴23",
  "6",
  "대기63",
  "대기63~",
  "휴24",
  "11",
  "대기6",
  "휴25",
  "휴51",
  "61",
  "61~",
  "휴26",
  "21",
  "65",
  "65~",
  "휴27",
  "16",
  "80",
  "80~",
  "휴28",
  "23",
  "대기64",
  "대기64~",
  "휴29",
  "9",
  "24",
  "휴30",
];

const 도봉순환: string[] = [
  "31",
  "36",
  "휴31",
  "30",
  "84",
  "84~",
  "휴32",
  "대기8",
  "82",
  "82~",
  "휴33",
  "38",
  "대기66",
  "대기66~",
  "휴34",
  "33",
  "83",
  "83~",
  "휴35",
  "39",
  "81",
  "81~",
  "휴36",
  "32",
  "휴37",
  "40",
  "85",
  "85~",
  "휴38",
  "35",
  "86",
  "86~",
  "휴39",
  "34",
  "87",
  "87~",
  "휴40",
  "37",
  "대기65",
  "대기65~",
  "휴41",
];

const 순환표: { [key: string]: string[] } = {
  대공원: 대공원순환,
  도봉: 도봉순환,
};

function 그날다이아(
  소속: string,
  시작다이아: string,
  기준날짜: string,
  보고싶은날짜: Date,
  휴무지정: string[]
): string | null {
  const 표 = 순환표[소속];
  if (!표) return null;
  const 시작idx = 표.indexOf(String(시작다이아));
  if (시작idx === -1) return null;
  const 칸수 = 표.length;
  const ms =
    new Date(보고싶은날짜).setHours(0, 0, 0, 0) -
    new Date(기준날짜).setHours(0, 0, 0, 0);
  const 지난일수 = Math.round(ms / (1000 * 60 * 60 * 24));
  let idx = (시작idx + 지난일수) % 칸수;
  if (idx < 0) idx += 칸수;
  const 원래 = 표[idx];
  if (휴무지정.includes(원래)) return "휴무";
  return 원래;
}

function 근무유형(다이아: string | null): string {
  if (!다이아) return "기타";
  if (다이아.endsWith("~")) return "비번";
  if (다이아.startsWith("휴")) return "휴무";
  if (다이아.startsWith("대기")) return "대기";
  const n = parseInt(다이아, 10);
  if (!isNaN(n)) return n >= 61 ? "야간" : "주간";
  return "기타";
}

const 유형색: { [key: string]: { bg: string; fg: string; label: string } } = {
  주간: { bg: "#EEF2FF", fg: "#3730A3", label: "주간" },
  야간: { bg: "#312E81", fg: "#FFFFFF", label: "야간" },
  비번: { bg: "#F3F4F6", fg: "#6B7280", label: "비번" },
  휴무: { bg: "#FEF2F2", fg: "#DC2626", label: "휴무" },
  대기: { bg: "#FEFCE8", fg: "#CA8A04", label: "대기" },
  기타: { bg: "#FFFFFF", fg: "#111827", label: "기타" },
};
// ===== 관리자: 근무 관리 화면 (WorkManageScreen) =====
// 이 전체를 App.tsx 안, function MemberManageScreen(...) { ... } 끝나는 곳 근처
// (다른 화면 컴포넌트들 옆)에 붙여넣으세요.

// ===== 관리자: 근무 관리 화면 (WorkManageScreen) - Supabase 저장 버전 =====
// 기존 function WorkManageScreen() {...} 전체를 이걸로 교체하세요.

function WorkManageScreen() {
  const [휴무목록, set휴무목록] = React.useState<
    { id: number; dia: string; 소속: string }[]
  >([]);
  const [휴무입력, set휴무입력] = React.useState("");

  const [소속입력, set소속입력] = React.useState("대공원");
  const [로딩, set로딩] = React.useState(false);

  React.useEffect(() => {
    불러오기();
  }, []);

  const 불러오기 = async () => {
    const { data, error } = await supabase
      .from("off_dias")
      .select("*")
      .order("created_at", { ascending: true });
    if (!error && data) set휴무목록(data as any);
  };

  const 휴무추가 = async () => {
    const v = 휴무입력.trim();
    if (!v) return;
    if (휴무목록.some((x) => x.dia === v && x.소속 === 소속입력)) {
      alert("이미 지정된 다이아입니다.");
      set휴무입력("");
      return;
    }
    set로딩(true);
    const { error } = await supabase
      .from("off_dias")
      .insert([{ dia: v, 소속: 소속입력 }]);
    set로딩(false);
    if (error) {
      alert("저장 실패: " + error.message);
      return;
    }
    set휴무입력("");
    불러오기();
  };

  const 휴무삭제 = async (id: number) => {
    const { error } = await supabase.from("off_dias").delete().eq("id", id);
    if (error) {
      alert("삭제 실패: " + error.message);
      return;
    }
    불러오기();
  };

  return (
    <div>
      <div
        style={{
          background: "#FEF2F2",
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontWeight: 800,
            color: "#DC2626",
            fontSize: 15,
            marginBottom: 6,
          }}
        >
          휴무 지정
        </div>
        <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.5 }}>
          사업소 지침으로 특정 다이아가 휴무가 될 때 번호를 지정하세요. 지정한
          다이아는 모든 조합원의 근무표에서 해당 번호가 나오는 날이 휴무로
          표시됩니다.
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 16,
          marginBottom: 16,
          boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
        }}
      >
        <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 8 }}>
          소속
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {["대공원", "도봉"].map((s) => (
            <button
              key={s}
              onClick={() => set소속입력(s)}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: 10,
                border:
                  소속입력 === s ? "2px solid #DC2626" : "1px solid #E5E7EB",
                background: 소속입력 === s ? "#FEF2F2" : "#fff",
                fontWeight: 소속입력 === s ? 700 : 400,
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 8 }}>
          휴무로 지정할 다이아 번호 (예: 3, 17)
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={휴무입력}
            onChange={(e) => set휴무입력(e.target.value)}
            placeholder="다이아 번호"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #E5E7EB",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={휴무추가}
            disabled={로딩}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: "#DC2626",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              opacity: 로딩 ? 0.6 : 1,
            }}
          >
            {로딩 ? "저장중" : "지정"}
          </button>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 16,
          boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#1F2937",
            marginBottom: 12,
          }}
        >
          지정된 휴무 다이아 ({휴무목록.length})
        </div>
        {휴무목록.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9CA3AF" }}>
            아직 지정된 휴무 다이아가 없습니다.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {휴무목록.map((item) => (
              <span
                key={item.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#FEF2F2",
                  color: "#DC2626",
                  borderRadius: 999,
                  padding: "6px 14px",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {item.소속} {item.dia}
                <button
                  onClick={() => 휴무삭제(item.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#DC2626",
                    cursor: "pointer",
                    fontSize: 16,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// [추가 위치] App.tsx에서 function SalaryScreen 바로 앞에 붙여넣기
// ============================================================

// ============================================================
// [교체 위치] App.tsx에서 기존 ScheduleScreen 함수 전체를 이 코드로 교체
// Ctrl+F → "function ScheduleScreen" 검색
// 함수 시작부터 끝 } 까지 전체 선택 후 이 코드로 교체
// ============================================================

// ============================================================
// [교체 위치] App.tsx에서 기존 ScheduleScreen 함수 전체를 이 코드로 교체
// ============================================================

// ============================================================
// [교체 위치] App.tsx에서 기존 ScheduleScreen 함수 전체를 이 코드로 교체
// ============================================================

// ============================================================
// [교체 위치] App.tsx에서 기존 ScheduleScreen 함수 전체를 이 코드로 교체
// ============================================================

// ============================================================
// [교체 위치] App.tsx에서 기존 ScheduleScreen 함수 전체를 이 코드로 교체
// ============================================================

function ScheduleScreen({ onBack, user, refreshUser }: { onBack: () => void; user: any; refreshUser?: () => void }) {
  const [activeTab, setActiveTab] = React.useState<
    "교대" | "교번" | "통상" | "변형통상"
  >(user?.work_type || "교대");
  const [currentYear, setCurrentYear] = React.useState(
    new Date().getFullYear()
  );
  const [currentMonth, setCurrentMonth] = React.useState(
    new Date().getMonth() + 1
  );

  // 슬라이드 상태
  const [offset, setOffset] = React.useState(0); // 현재 드래그 offset (px)
  const [isAnimating, setIsAnimating] = React.useState(false);
  const touchStartX = React.useRef(0);
  const containerWidth = React.useRef(430);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // 교대
  const [selectedCrew, setSelectedCrew] = React.useState<
    "A" | "B" | "C" | "D" | null
  >(user?.work_group || null);
  const [shiftViewMode, setShiftViewMode] = React.useState<"crew" | "all">(
    "crew"
  );
  const [shiftBase, setShiftBase] = React.useState<any>(null);
  const [crewLoaded, setCrewLoaded] = React.useState(false);
  const [dayDetail, setDayDetail] = React.useState<{
    date: Date;
    works: any[];
  } | null>(null);

  // 메모
  const [memos, setMemos] = React.useState<Record<string, any[]>>({});
  const [editingDate, setEditingDate] = React.useState<string | null>(null);
  const [newMemoText, setNewMemoText] = React.useState("");
  const [editingMemoId, setEditingMemoId] = React.useState<number | null>(null);
  const [editingMemoText, setEditingMemoText] = React.useState("");
  const [savingMemo, setSavingMemo] = React.useState(false);

  // 교번
  const [selectedGroup, setSelectedGroup] = React.useState<
    "대공원" | "도봉" | null
  >(null);
  const [selectedMember, setSelectedMember] = React.useState<any>(null);
  const [members, setMembers] = React.useState<any[]>([]);
  const [rotationData, setRotationData] = React.useState<any[]>([]);
const [holidays, setHolidays] = React.useState<string[]>([]);
  const [diaTable, setDiaTable] = React.useState<any[]>([]);
 const [adjustRecords, setAdjustRecords] = React.useState<any[]>([]);
  const [leaveRecords, setLeaveRecords] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!selectedMember?.employee_number) { setLeaveRecords([]); return; }
    const loadLeave = async () => {
      const { data } = await supabase
        .from("leave_history")
        .select("*")
        .eq("employee_number", selectedMember.employee_number)
        .neq("status", "취소");
      if (data) setLeaveRecords(data);
    };
    loadLeave();
  }, [selectedMember]);

  // 근무조정 기록 불러오기 (선택된 사람 기준)
  React.useEffect(() => {
    if (!selectedMember?.employee_number) { setAdjustRecords([]); return; }
    const loadAdjust = async () => {
      const { data } = await supabase
        .from("work_adjust")
        .select("*")
        .eq("employee_number", selectedMember.employee_number);
      if (data) setAdjustRecords(data);
    };
    loadAdjust();
  }, [selectedMember]);

  // 교번교체(수락된 것) 불러오기 - 선택된 사람이 a거나 b인 경우
  const [swapData, setSwapData] = React.useState<any[]>([]);
  React.useEffect(() => {
    if (!selectedMember?.employee_number) { setSwapData([]); return; }
    const loadSwaps = async () => {
      const emp = String(selectedMember.employee_number);
      const { data } = await supabase
        .from("kyobun_swap")
        .select("*")
        .eq("status", "수락")
        .or(`a_employee_number.eq.${emp},b_employee_number.eq.${emp}`);
      if (data) setSwapData(data);
    };
    loadSwaps();
  }, [selectedMember]);

  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [memberSearch, setMemberSearch] = React.useState("");
  const [favorites, setFavorites] = React.useState<any[]>([]);
  const [favMode, setFavMode] = React.useState(false);
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const today = new Date();

  // 이전달/다음달 계산
  const getPrevMonth = (y: number, m: number) =>
    m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const getNextMonth = (y: number, m: number) =>
    m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };

  React.useEffect(() => {
    if (containerRef.current) {
      containerWidth.current = containerRef.current.offsetWidth || 430;
    }
  }, []);

  React.useEffect(() => {
    const init = async () => {
      const [{ data: baseData }, { data: crewData }] = await Promise.all([
        supabase
          .from("shift_base")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        user?.employee_number
          ? supabase
              .from("crew_settings")
              .select("crew")
              .eq("employee_number", user.employee_number)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (baseData) setShiftBase(baseData);
      if (user?.work_group) {
        setSelectedCrew(user.work_group as any);
      } else if (crewData?.crew) {
        setSelectedCrew(crewData.crew as any);
      }
      if (user?.work_type === "교번" && (user?.work_group === "대공원" || user?.work_group === "도봉")) {
        setSelectedGroup(user.work_group as any);
      }
      setCrewLoaded(true);
    };
    init();
  }, []);

  // 메모 불러오기 (현재달 + 앞뒤달)
  React.useEffect(() => {
    if (!user?.employee_number) return;
    const fetchMemos = async () => {
      const prev = getPrevMonth(currentYear, currentMonth);
      const next = getNextMonth(currentYear, currentMonth);
      const startDate = `${prev.y}-${String(prev.m).padStart(2, "0")}-01`;
      const endDate = `${next.y}-${String(next.m).padStart(2, "0")}-${new Date(
        next.y,
        next.m,
        0
      ).getDate()}`;
      const { data } = await supabase
        .from("schedule_memo")
        .select("id, memo_date, content, sort_order")
        .eq("employee_number", user.employee_number)
        .gte("memo_date", startDate)
        .lte("memo_date", endDate)
        .order("sort_order");
      if (data) {
        const map: Record<string, any[]> = {};
        data.forEach((m: any) => {
          if (!map[m.memo_date]) map[m.memo_date] = [];
          map[m.memo_date].push(m);
        });
        setMemos(map);
      }
    };
    fetchMemos();
  }, [currentYear, currentMonth, user]);

  React.useEffect(() => {
    if (!selectedGroup) return;
    const fetch = async () => {
      setLoadingMembers(true);
      setSelectedMember(null);
      const { data } = await supabase
        .from("members")
        .select(
          "id, name, employee_number, work_group, start_position, schedule_total"
        )
        .in("work_group", ["대공원", "도봉"])
        .order("name");
if (data) {
        setMembers(data);
        if (
          user?.work_type === "교번" &&
          user?.employee_number &&
          selectedGroup === user?.work_group
        ) {
          const me = data.find(
            (m) => String(m.employee_number) === String(user.employee_number)
          );
          if (me) setSelectedMember(me);
        }
      }
      setLoadingMembers(false);
    };
    fetch();
  }, [selectedGroup]);

  React.useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("schedule_rotation")
        .select("*")
        .in("group_name", ["대공원 114", "도봉 41"])
        .order("position");
      if (data) setRotationData(data);
    };
    fetch();
  }, []);
  // ============================================================
  // [추가 위치 1] ScheduleScreen 안에서
  // const [loadingMembers 바로 아래에 추가
  // ============================================================

  // ============================================================
  // [추가 위치 2] 교번 순환표 useEffect 바로 아래에 추가
  // ============================================================
  // 공휴일 불러오기 (한국천문연구원 API)
  React.useEffect(() => {
    const fetchHolidays = async () => {
      try {
        const res = await fetch(
          "/.netlify/functions/read-holidays?year=" + currentYear
        );
        const json = await res.json();
        if (json.holidays) setHolidays(json.holidays);
      } catch (e) {
        console.log("공휴일 불러오기 실패", e);
      }
    };
    fetchHolidays();
  }, [currentYear]);

  // 교번 다이아 시간표 전체 불러오기
  React.useEffect(() => {
    const fetchDia = async () => {
      const { data } = await supabase.from("kyobun_dia").select("*");
      if (data) setDiaTable(data);
    };
    fetchDia();
  }, []);

  // 즐겨찾기 불러오기
  React.useEffect(() => {
    if (!user?.employee_number) return;
    const fetchFavs = async () => {
      const { data } = await supabase
        .from("schedule_favorites")
        .select(
          "id, fav_member_id, members(id, name, work_group, start_position, schedule_total)"
        )
        .eq("employee_number", user.employee_number);
      if (data) {
        setFavorites(
          data.map((f: any) => ({
            fav_id: f.id,
            id: f.members.id,
            name: f.members.name,
            work_group: f.members.work_group,
            start_position: f.members.start_position,
            schedule_total: f.members.schedule_total,
          }))
        );
      }
    };
    fetchFavs();
  }, [user]);

  // 즐겨찾기 추가
  const addFavorite = async (member: any) => {
    if (!user?.employee_number) return;
    if (favorites.length >= 5) {
      alert("즐겨찾기는 최대 5명까지 가능해요.");
      return;
    }
    const { data, error } = await supabase
      .from("schedule_favorites")
      .insert({
        employee_number: user.employee_number,
        fav_member_id: member.id,
      })
      .select("id")
      .single();
    if (!error && data) {
      setFavorites((prev) => [...prev, { fav_id: data.id, ...member }]);
    }
  };

  // 즐겨찾기 삭제
  const removeFavorite = async (favId: number) => {
    const { error } = await supabase
      .from("schedule_favorites")
      .delete()
      .eq("id", favId);
    if (!error) {
      setFavorites((prev) => prev.filter((f) => f.fav_id !== favId));
    }
  };
  const handleCrewSelect = async (crew: "A" | "B" | "C" | "D") => {
    setSelectedCrew(crew);
    setShiftViewMode("crew");
    if (!user?.employee_number) return;
    await supabase.from("crew_settings").upsert(
      {
        employee_number: user.employee_number,
        crew,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_number" }
    );
  };

  // 터치 핸들러
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isAnimating) return;
    touchStartX.current = e.touches[0].clientX;
    setOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isAnimating) return;
    const diff = e.touches[0].clientX - touchStartX.current;
    setOffset(diff);
  };

  const handleTouchEnd = () => {
    if (isAnimating) return;
    const w = containerWidth.current;
    if (Math.abs(offset) > w * 0.25) {
      // 슬라이드 완료
      const goNext = offset < 0;
      const targetOffset = goNext ? -w : w;
      setIsAnimating(true);
      setOffset(targetOffset);
      setTimeout(() => {
        if (goNext) {
          const next = getNextMonth(currentYear, currentMonth);
          setCurrentYear(next.y);
          setCurrentMonth(next.m);
        } else {
          const prev = getPrevMonth(currentYear, currentMonth);
          setCurrentYear(prev.y);
          setCurrentMonth(prev.m);
        }
        setOffset(0);
        setIsAnimating(false);
      }, 300);
    } else {
      // 원위치
      setIsAnimating(true);
      setOffset(0);
      setTimeout(() => setIsAnimating(false), 300);
    }
  };

  const getShiftWork = (조: "A" | "B" | "C" | "D", date: Date): string => {
    if (!shiftBase) return "";
    const 순환 = ["주간", "야간", "비번", "휴무"];
    const 기준일 = new Date(shiftBase.base_date);
    기준일.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - 기준일.getTime()) / 86400000);
    const bases: Record<string, number> = {
      A: 순환.indexOf(shiftBase.a_work_type),
      B: 순환.indexOf(shiftBase.b_work_type),
      C: 순환.indexOf(shiftBase.c_work_type),
      D: 순환.indexOf(shiftBase.d_work_type),
    };
    return 순환[(((bases[조] + diff) % 4) + 4) % 4];
  };

  // 날짜가 휴일(주말 or 공휴일)인지 판단
  const isHolidayDate = (d: Date) => {
    const day = d.getDay();
    if (day === 0 || day === 6) return true;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return holidays.includes(`${y}-${m}-${dd}`);
  };

  // 근무타입 + 날짜로 다이아 구분(day_type) 결정
  const getDiaDayType = (type: string, date: Date) => {
    const todayHol = isHolidayDate(date);
    const tomorrow = new Date(date);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomoHol = isHolidayDate(tomorrow);
    if (type === "주간") return todayHol ? "휴일" : "평일";
    if (type === "야간") {
      if (!todayHol && !tomoHol) return "평평";
      if (!todayHol && tomoHol) return "평휴";
      if (todayHol && tomoHol) return "휴휴";
      if (todayHol && !tomoHol) return "휴평";
    }
    return null;
  };

  // 다이아번호 + 구분으로 시간표 찾기
  const getDiaInfo = (diaNo: any, dayType: string | null) => {
    if (!dayType || diaNo == null) return null;
    return (
      diaTable.find(
        (r) => Number(r.dia_no) === Number(diaNo) && r.day_type === dayType
      ) || null
    );
  };


  
React.useEffect(() => {
    if (!selectedMember?.employee_number) { setAdjustRecords([]); return; }
    const loadAdjust = async () => {
      const { data } = await supabase
        .from("work_adjust")
        .select("*")
        .eq("employee_number", selectedMember.employee_number);
      if (data) setAdjustRecords(data);
    };
    loadAdjust();
  }, [selectedMember]);

  
const getKyobunWork = (member: any, date: Date) => {
    if (!member || rotationData.length === 0) return null;

    const calc = (mem: any) => {
      const groupName = mem.work_group === "도봉" ? "도봉 41" : "대공원 114";
      const base = new Date("2026-06-01");
      base.setHours(0, 0, 0, 0);
      const target = new Date(date);
      target.setHours(0, 0, 0, 0);
      const diff = Math.round((target.getTime() - base.getTime()) / 86400000);
      const pos =
        ((((mem.start_position - 1 + diff) % mem.schedule_total) +
          mem.schedule_total) %
          mem.schedule_total) + 1;
      const row = rotationData.find(
        (r) => r.group_name === groupName && r.position === pos
      );
      return row ? { dia: row.dia_value, type: row.work_type } : null;
    };

    const mine = calc(member);

    const y = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const dateStr = `${y}-${mm}-${dd}`;
    const emp = String(member.employee_number);

    const swap = swapData.find(
      (s) =>
        s.swap_date === dateStr &&
        (String(s.a_employee_number) === emp ||
          String(s.b_employee_number) === emp)
    );
    if (swap) {
      const partnerEmp =
        String(swap.a_employee_number) === emp
          ? String(swap.b_employee_number)
          : String(swap.a_employee_number);
      const partner = members.find(
        (p) => String(p.employee_number) === partnerEmp
      );
      if (partner) {
        const partnerWork = calc(partner);
        if (partnerWork) return { ...partnerWork, swapped: true };
      }
    }
    return mine;
  };
  const isToday = (y: number, m: number, d: number) =>
    d === today.getDate() &&
    m === today.getMonth() + 1 &&
    y === today.getFullYear();

  const dateKey = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const workInfo = (type: string) => {
    switch (type) {
      case "주간":
        return { short: "주", bg: "#DBEAFE", text: "#1D4ED8" };
      case "야간":
        return { short: "야", bg: "#EDE9FE", text: "#6D28D9" };
      case "비번":
        return { short: "비", bg: "#F3F4F6", text: "#6B7280" };
      case "휴무":
        return { short: "휴", bg: "#FEF3C7", text: "#92400E" };
      case "대기":
        return { short: "대", bg: "#D1FAE5", text: "#065F46" };
      case "대기비번":
        return { short: "대비", bg: "#ECFDF5", text: "#10B981" };
      default:
        return { short: "-", bg: "#F9FAFB", text: "#9CA3AF" };
    }
  };

  const addMemo = async (dateStr: string) => {
    if (!newMemoText.trim() || !user?.employee_number) return;
    const dayMemos = memos[dateStr] || [];
    if (dayMemos.length >= 5) {
      alert("날짜당 최대 5개까지 입력 가능해요.");
      return;
    }
    setSavingMemo(true);
    const { data, error } = await supabase
      .from("schedule_memo")
      .insert({
        employee_number: user.employee_number,
        memo_date: dateStr,
        content: newMemoText.trim(),
        sort_order: dayMemos.length + 1,
      })
      .select()
      .single();
    if (!error && data) {
      setMemos((prev) => ({
        ...prev,
        [dateStr]: [...(prev[dateStr] || []), data],
      }));
      setNewMemoText("");
    }
    setSavingMemo(false);
  };

  const updateMemo = async (memoId: number, dateStr: string) => {
    if (!editingMemoText.trim()) return;
    setSavingMemo(true);
    const { error } = await supabase
      .from("schedule_memo")
      .update({
        content: editingMemoText.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", memoId);
    if (!error) {
      setMemos((prev) => ({
        ...prev,
        [dateStr]: prev[dateStr].map((m) =>
          m.id === memoId ? { ...m, content: editingMemoText.trim() } : m
        ),
      }));
      setEditingMemoId(null);
    }
    setSavingMemo(false);
  };

  const deleteMemo = async (memoId: number, dateStr: string) => {
    const { error } = await supabase
      .from("schedule_memo")
      .delete()
      .eq("id", memoId);
    if (!error) {
      setMemos((prev) => {
        const updated = (prev[dateStr] || []).filter((m) => m.id !== memoId);
        if (updated.length === 0) {
          const n = { ...prev };
          delete n[dateStr];
          return n;
        }
        return { ...prev, [dateStr]: updated };
      });
    }
  };

  const tabs = ["교대", "교번", "통상", "변형통상"] as const;

  // ── 달력 그리기 (년월 파라미터 받음) ──
  const buildCalendarGrid = (y: number, m: number) => {
    const lastDate = new Date(y, m, 0).getDate();
    const firstDow = new Date(y, m - 1, 1).getDay();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= lastDate; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  };

  // ── 달력 패널 하나 렌더링 ──
  const renderCalendarPanel = (
    y: number,
    m: number,
    crew: "A" | "B" | "C" | "D"
  ) => {
    const weeks = buildCalendarGrid(y, m);
    return (
      <div>
        {weeks.map((week, wi) => (
          <div
            key={wi}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7,1fr)",
              borderBottom: "1px solid #F3F4F6",
            }}
          >
            {week.map((day, di) => {
              if (!day)
                return (
                  <div
                    key={di}
                    style={{
                      minHeight: 72,
                      background: "#FAFAFA",
                      borderRight: "1px solid #F3F4F6",
                    }}
                  />
                );
              const date = new Date(y, m - 1, day);
              const work = getShiftWork(crew, date);
              const info = workInfo(work);
              const isT = isToday(y, m, day);
              const isSun = di === 0,
                isSat = di === 6;
              const key = dateKey(y, m, day);
              const dayMemos = memos[key] || [];
              const isEditing = editingDate === key;

              return (
                <div
                  key={di}
                  onClick={() => {
                    if (isEditing) {
                      setEditingDate(null);
                      setNewMemoText("");
                    } else {
                      setEditingDate(key);
                      setEditingMemoId(null);
                      setNewMemoText("");
                    }
                  }}
                  style={{
                    padding: "6px 4px",
                    minHeight: 72,
                    background: isEditing
                      ? "#EEF2FF"
                      : isT
                      ? "#F0F4FF"
                      : "#fff",
                    borderRight: "1px solid #F3F4F6",
                    cursor: "pointer",
                    borderTop: isT
                      ? "2px solid #4F46E5"
                      : "2px solid transparent",
                    outline: isEditing ? "2px solid #A5B4FC" : "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: isT ? 800 : 500,
                      textAlign: "center",
                      marginBottom: 4,
                      color: isSun ? "#EF4444" : isSat ? "#3B82F6" : "#1F2937",
                    }}
                  >
                    {isT ? (
                      <span
                        style={{
                          background: "#4F46E5",
                          color: "#fff",
                          borderRadius: "50%",
                          width: 22,
                          height: 22,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                        }}
                      >
                        {day}
                      </span>
                    ) : (
                      day
                    )}
                  </div>
                  {work && (
                    <div
                      style={{
                        textAlign: "center",
                        color: info.text,
                        borderRadius: 6,
                        padding: "3px 0",
                        fontSize: 12,
                        fontWeight: 700,
                        margin: "0 2px",
                      }}
                    >
                      {info.short === "주"
                        ? "주간"
                        : info.short === "야"
                        ? "야간"
                        : info.short === "비"
                        ? "비번"
                        : info.short === "휴"
                        ? "휴무"
                        : info.short}
                    </div>
                  )}
                  {dayMemos.length > 0 && (
                    <div style={{ textAlign: "center", marginTop: 3 }}>
                      {dayMemos.slice(0, 3).map((_, i) => (
                        <span
                          key={i}
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: "50%",
                            background: "#6366F1",
                            display: "inline-block",
                            margin: "0 1px",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  // ── 메모 패널 ──
  const renderMemoPanel = (dateStr: string) => {
    const dayMemos = memos[dateStr] || [];
    return (
      <div
        style={{
          margin: "0 12px 12px",
          background: "#fff",
          borderRadius: 14,
          border: "1.5px solid #DDD6FE",
          overflow: "hidden",
          boxShadow: "0 4px 16px rgba(79,70,229,0.12)",
        }}
      >
        {(() => {
          const dateObj = new Date(dateStr);
          const crewsList: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
          const LABEL_MAP: Record<string, string> = {
            주: "주간",
            야: "야간",
            비: "비번",
            휴: "휴무",
          };
          const COLOR_MAP: Record<string, string> = {
            주: "#3B82F6",
            야: "#7C3AED",
            비: "#9CA3AF",
            휴: "#92400E",
          };
          return (
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid #EDE9FE",
                background: "#FAFAFE",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#6B7280",
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                4개조 근무
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                {crewsList.map((c) => {
                  const w = getShiftWork(c, dateObj);
                  const i = w ? workInfo(w) : null;
                  return (
                    <div
                      key={c}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "5px 10px",
                        background: "#fff",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: "#374151", fontWeight: 600 }}>
                        {c}조
                      </span>
                      <span
                        style={{
                          color: i
                            ? COLOR_MAP[i.short] || "#6B7280"
                            : "#D1D5DB",
                          fontWeight: 600,
                        }}
                      >
                        {i ? LABEL_MAP[i.short] || i.short : "-"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        <div
          style={{
            padding: "12px 14px 8px",
            background: "#F5F3FF",
            borderBottom: "1px solid #EDE9FE",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#4F46E5" }}>
            📝 {dateStr.slice(5).replace("-", "/")} 메모
            <span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: 6 }}>
              {dayMemos.length}/5
            </span>
          </div>
        </div>
        <div style={{ padding: "8px 14px" }}>
          {dayMemos.map((memo, idx) => (
            <div
              key={memo.id}
              style={{
                padding: "8px 0",
                borderBottom:
                  idx < dayMemos.length - 1 ? "1px solid #F3F4F6" : "none",
              }}
            >
              {editingMemoId === memo.id ? (
                <div>
                  <textarea
                    value={editingMemoText}
                    onChange={(e) => setEditingMemoText(e.target.value)}
                    rows={2}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1.5px solid #A5B4FC",
                      fontSize: 13,
                      resize: "none",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                    }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      onClick={() => updateMemo(memo.id, dateStr)}
                      disabled={savingMemo}
                      style={{
                        flex: 1,
                        padding: "6px 0",
                        borderRadius: 7,
                        background: "#4F46E5",
                        color: "#fff",
                        border: "none",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {savingMemo ? "..." : "저장"}
                    </button>
                    <button
                      onClick={() => setEditingMemoId(null)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 7,
                        background: "#F3F4F6",
                        color: "#6B7280",
                        border: "none",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: "#9CA3AF",
                      marginTop: 2,
                      flexShrink: 0,
                    }}
                  >
                    {idx + 1}.
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      color: "#374151",
                      lineHeight: 1.5,
                    }}
                  >
                    {memo.content}
                  </span>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => {
                        setEditingMemoId(memo.id);
                        setEditingMemoText(memo.content);
                      }}
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: "#EEF2FF",
                        color: "#4F46E5",
                        border: "none",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      수정
                    </button>
                    <button
                      onClick={() => deleteMemo(memo.id, dateStr)}
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        background: "#FEF2F2",
                        color: "#EF4444",
                        border: "none",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {dayMemos.length < 5 ? (
            <div style={{ marginTop: dayMemos.length > 0 ? 10 : 0 }}>
              <textarea
                value={newMemoText}
                onChange={(e) => setNewMemoText(e.target.value)}
                placeholder="메모 추가..."
                rows={2}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 13,
                  resize: "none",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  onClick={() => addMemo(dateStr)}
                  disabled={savingMemo || !newMemoText.trim()}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    borderRadius: 8,
                    background: newMemoText.trim() ? "#4F46E5" : "#E5E7EB",
                    color: newMemoText.trim() ? "#fff" : "#9CA3AF",
                    border: "none",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {savingMemo ? "저장 중..." : "추가"}
                </button>
                <button
                  onClick={() => {
                    setEditingDate(null);
                    setNewMemoText("");
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "#F3F4F6",
                    color: "#6B7280",
                    border: "none",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  닫기
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 8,
              }}
            >
              <button
                onClick={() => {
                  setEditingDate(null);
                  setNewMemoText("");
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  background: "#F3F4F6",
                  color: "#6B7280",
                  border: "none",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                닫기
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── 캐러셀 슬라이드 컨테이너 ──
  const renderSlideCalendar = (crew: "A" | "B" | "C" | "D") => {
    const prev = getPrevMonth(currentYear, currentMonth);
    const next = getNextMonth(currentYear, currentMonth);
    const w = containerWidth.current;

    return (
      <div
        style={{ overflow: "hidden", position: "relative", touchAction: "pan-y" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* 요일 헤더 (고정) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            background: "#F5F3FF",
          }}
        >
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <div
              key={d}
              style={{
                textAlign: "center",
                padding: "8px 0",
                fontSize: 12,
                fontWeight: 700,
                color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "#6B7280",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* 슬라이드 트랙: 이전달 + 현재달 + 다음달 */}
        <div
          style={{
            display: "flex",
            transform: `translateX(calc(-100% + ${offset}px))`,
            transition:
              isAnimating && offset === 0
                ? "transform 0.3s cubic-bezier(0.1,0.46,0.45,0.94)"
                : isAnimating
                ? "transform 0.3s cubic-bezier(0.1,0.46,0.45,0.94)"
                : "none",
            willChange: "transform",
          }}
        >
          {/* 이전달 */}
          <div style={{ minWidth: "100%", flexShrink: 0 }}>
            {renderCalendarPanel(prev.y, prev.m, crew)}
          </div>
          {/* 현재달 */}
          <div style={{ minWidth: "100%", flexShrink: 0 }}>
            {renderCalendarPanel(currentYear, currentMonth, crew)}
          </div>
          {/* 다음달 */}
          <div style={{ minWidth: "100%", flexShrink: 0 }}>
            {renderCalendarPanel(next.y, next.m, crew)}
          </div>
        </div>

        {/* 메모 패널 */}
        {editingDate && renderMemoPanel(editingDate)}

        

        {/* 전체보기 */}
        <div style={{ padding: "0 16px 20px" }}>
          <button
            onClick={() => setShiftViewMode("all")}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 12,
              background: "#F5F3FF",
              color: "#4F46E5",
              border: "1.5px solid #DDD6FE",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📋 전체 조 보기 (A/B/C/D)
          </button>
        </div>
      </div>
    );
  };

  // ── 조 선택 화면 ──
  const renderCrewSelect = () => (
    <div style={{ padding: "24px 16px" }}>
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#1F2937",
          marginBottom: 16,
        }}
      >
        내 조를 선택하세요
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {(["A", "B", "C", "D"] as const).map((crew) => {
          const work = shiftBase ? getShiftWork(crew, today) : "-";
          const info = workInfo(work);
          return (
            <button
              key={crew}
              onClick={() => handleCrewSelect(crew)}
              style={{
                padding: "20px 0",
                borderRadius: 16,
                border: `2px solid ${info.bg}`,
                background: "#fff",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: "#4F46E5",
                  marginBottom: 6,
                }}
              >
                {crew}조
              </div>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 6 }}>
                오늘
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  padding: "4px 16px",
                  borderRadius: 20,
                  background: info.bg,
                  color: info.text,
                }}
              >
                {work}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── 교번 탭 ──
  const renderKyobunTab = () => {
    if (!selectedGroup)
      return (
        <div style={{ padding: "24px 16px" }}>
          <button
            onClick={() => setSelectedGroup(user?.work_group as any)}
            style={{
              background: "none",
              border: "none",
              color: "#6366F1",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              marginBottom: 16,
              padding: 0,
            }}
          >
            ← 내 근무표 보기
          </button>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#1F2937",
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            대공원 승무 사업소
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            {["현장조치 매뉴얼", "업무용 전화번호", "직원 연락처"].map((label) => (
              <button
                key={label}
                onClick={() => alert(label + " (준비중)")}
                style={{
                  padding: "28px 12px",
                  borderRadius: 16,
                  border: "2px solid #E5E7EB",
                  background: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#374151",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      );
    if (!selectedMember)
      // ============================================================
      // [교체 위치] renderKyobunTab 함수 안에서
      // !selectedMember 일 때 return 하는 부분 전체 교체
      //
      // 찾는 방법: Ctrl+F → "selectedGroup} 기관사 선택" 검색
      // return ( 부터 마지막 ); 까지 선택 후 아래 코드로 교체
      // ============================================================

            return (
        <div style={{ padding: "16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <button
              onClick={() => {
                setSelectedGroup(null);
                setMemberSearch("");
              }}
              style={{
                background: "#EEF2FF",
                border: "none",
                color: "#6366F1",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                padding: "5px 13px",
                borderRadius: 999,
                fontFamily: "inherit",
              }}
            >
              ← 메뉴화면
            </button>
            <button
              onClick={() => {
                const me = members.find(
                  (m) => String(m.employee_number) === String(user?.employee_number)
                );
                if (me) setSelectedMember(me);
              }}
              style={{
                background: "#EEF2FF",
                border: "none",
                color: "#6366F1",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                padding: "5px 13px",
                borderRadius: 999,
                fontFamily: "inherit",
              }}
            >
              내 근무 →
            </button>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#F5F3FF",
              borderRadius: 12,
              padding: "10px 14px",
              border: "1.5px solid #DDD6FE",
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 16 }}>🔍</span>
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder={`기관사 이름 검색`}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                fontSize: 14,
                color: "#374151",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            {memberSearch && (
              <button
                onClick={() => setMemberSearch("")}
                style={{
                  background: "none",
                  border: "none",
                  color: "#9CA3AF",
                  fontSize: 16,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {loadingMembers ? (
            <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>
              불러오는 중...
            </div>
          ) : (
            <div>
              {!memberSearch && favorites.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8 }}>
                    ⭐ 즐겨찾기
                  </div>
                  {favorites.map((m) => (
                    <div
                      key={"fav" + m.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 4px",
                        borderBottom: "1px solid #F3F4F6",
                      }}
                    >
                      <div
                        onClick={() => setSelectedMember(m)}
                        style={{ flex: 1, cursor: "pointer", fontSize: 15, color: "#1F2937" }}
                      >
                        {m.name}
                      </div>
                      <button
                        onClick={() => removeFavorite(m.fav_id)}
                        style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}
                      >
                        ⭐
                      </button>
                    </div>
                  ))}
                </div>
              )}

                        {memberSearch ? (
                members
                  .filter((m) =>
                    (m.name || "").replace(/\s/g, "").includes(memberSearch.replace(/\s/g, ""))
                  )
                  .map((m) => {
                    const isFav = favorites.some((f) => f.id === m.id);
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 4px",
                          borderBottom: "1px solid #F3F4F6",
                        }}
                      >
                        <div
                          onClick={() => setSelectedMember(m)}
                          style={{ flex: 1, cursor: "pointer", fontSize: 15, color: "#1F2937" }}
                        >
                          {m.name}
                        </div>
                        <button
                          onClick={() =>
                            isFav
                              ? removeFavorite(favorites.find((f) => f.id === m.id).fav_id)
                              : addFavorite(m)
                          }
                          style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}
                        >
                          {isFav ? "⭐" : "☆"}
                        </button>
                      </div>
                    );
                  })
              ) : (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#C4B5FD", fontSize: 13 }}>
                  이름을 입력해서 검색하세요
                  <br />
                  <span style={{ fontSize: 11, color: "#D1D5DB" }}>
                    ☆ 버튼으로 즐겨찾기 추가 가능해요
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      );

    const weeks = buildCalendarGrid(currentYear, currentMonth);
    let cntDay = 0, cntNight = 0, cntRest = 0;
    for (let d = 1; d <= new Date(currentYear, currentMonth, 0).getDate(); d++) {
      const w = getKyobunWork(selectedMember, new Date(currentYear, currentMonth - 1, d));
      if (w) {
        if (w.type === "주간") cntDay++;
        else if (w.type === "야간") cntNight++;
        else if (w.type === "휴무") cntRest++;
      }
    }
    return (
      <div>
        <div
          style={{
            padding: "8px 16px",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            borderBottom: "1px solid #EEF0F3",
            position: "sticky",
            top: 56,
          }}
        >
         <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {String(selectedMember.employee_number) !== String(user?.employee_number) && (
              <span style={{ fontSize: 15, fontWeight: 800, color: "#1F2937" }}>
                {selectedMember.name}
              </span>
            )}
            <span style={{ display: "flex", gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#DBEAFE", color: "#1D4ED8" }}>
                주 {cntDay}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#EDE9FE", color: "#6D28D9" }}>
                야 {cntNight}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "#F3F4F6", color: "#6B7280" }}>
                휴 {cntRest}
              </span>
            </span>
          </div>
          <button
            onClick={() => setSelectedMember(null)}
            style={{
              background: "#EEF2FF",
              border: "none",
              color: "#6366F1",
              fontSize: 12,
              cursor: "pointer",
              padding: "3px 11px",
              borderRadius: 999,
              fontFamily: "inherit",
            }}
          >
            🔍 기관사 검색
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            background: "#F5F3FF",
          }}
        >
          {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
            <div
              key={d}
              style={{
                textAlign: "center",
                padding: "8px 0",
                fontSize: 12,
                fontWeight: 700,
                color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "#6B7280",
              }}
            >
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div
            key={wi}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7,1fr)",
              borderBottom: "1px solid #F3F4F6",
            }}
          >
            {week.map((day, di) => {
              if (!day)
                return (
                  <div
                    key={di}
                    style={{
                      minHeight: 70,
                      background: "#FAFAFA",
                      borderRight: "1px solid #F3F4F6",
                    }}
                  />
                );
              const date = new Date(currentYear, currentMonth - 1, day);
              const work = getKyobunWork(selectedMember, date);
              const info = work ? workInfo(work.type) : workInfo("");
                          const diaDayType = work ? getDiaDayType(work.type, date) : null;
              const diaInfo = work ? getDiaInfo(work.dia, diaDayType) : null;

              const isT = isToday(currentYear, currentMonth, day);
              const isSun = di === 0,
                isSat = di === 6;
              return (
                <div
                  key={di}
                  style={{
                    padding: "6px 4px",
                    minHeight: 70,
                    background: isT ? "#EEF2FF" : "#fff",
                    borderRight: "1px solid #F3F4F6",
                    borderTop: isT
                      ? "2px solid #4F46E5"
                      : "2px solid transparent",
                  }}
                >
                                   {(() => {
                    const isHoli = isHolidayDate(date) && !isSun && !isSat;
                    const dayColor = isSun || isHoli ? "#EF4444" : isSat ? "#3B82F6" : "#111827";
                    const subColor = isSun || isHoli ? "#F87171" : isSat ? "#93C5FD" : "#374151";
                    const isRest = work && work.type === "휴무";
                    const isOff = work && work.type === "비번";
                    return (
                      <>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textAlign: "center",
                            marginBottom: 4,
                            color: isSun || isHoli ? "#F87171" : isSat ? "#93C5FD" : "#9CA3AF",
                          }}
                        >
                          {isT ? (
                            <span
                              style={{
                                background: "#4F46E5",
                                color: "#fff",
                                borderRadius: "50%",
                                width: 17,
                                height: 17,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 9.5,
                              }}
                            >
                              {day}
                            </span>
                          ) : (
                            day
                          )}
                        </div>
                       {work && (work as any).swapped && (
                          <div style={{ textAlign: "center", fontSize: 10, color: "#4F46E5", fontWeight: 700, marginBottom: 2 }}>
                            🔄 교체
                          </div>
                        )}
                        {work && (isRest ? (
                          <div style={{ textAlign: "center", fontSize: 16, fontWeight: 700, color: subColor, marginTop: 7 }}>
                            휴
                          </div>
                        ) : isOff ? (
                          <div style={{ textAlign: "center", fontSize: 16, color: "#D1D5DB", marginTop: 7 }}>
                            ~
                          </div>
                        ) : (
                          <>
                            <div style={{ textAlign: "center", fontSize: 15, fontWeight: 800, color: dayColor, lineHeight: 1, marginBottom: 4 }}>
                              {work.dia}
                            </div>
                            {diaInfo && diaInfo.start_time && (
                              <div
                                style={{
                                  textAlign: "center",
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  color: dayColor,
                                  background: isHoli ? "#FEE2E2" : "#F3F4F6",
                                  borderRadius: 7,
                                  padding: "2px 6px",
                                  margin: "0 auto",
                                  display: "inline-block",
                                  letterSpacing: "-0.5px",
                                  whiteSpace: "nowrap",
                                  maxWidth: "100%",
                                }}
                              >
                                {diaInfo.start_time}
                              </div>
                            )}
                          </>
                        ))}
                      </>
                    );
                  })()}
{(() => {
                    const dstr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const recs = adjustRecords.filter((r) => r.work_date === dstr);
                    if (recs.length === 0) return null;
                    const LABEL = {
                      standby: "충당", holiday_fill: "휴충", designated: "지정", support: "지원",
                    };
                    const COLOR = {
                      standby: { bg: "#EDE9FE", fg: "#6D28D9" },
                      holiday_fill: { bg: "#FAEEDA", fg: "#854F0B" },
                      designated: { bg: "#E1F5EE", fg: "#0F6E56" },
                      support: { bg: "#E6F1FB", fg: "#185FA5" },
                    };
                    return (
                      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                        {recs.map((r, i) => {
                          const c = COLOR[r.adjust_type] || { bg: "#F3F4F6", fg: "#374151" };
                          const m = (r.memo || "").match(/다이아\s*(\d+)/);
                          const shiftMark = r.work_shift === "야간" ? "야" : "주";
                          const sub = m ? `${shiftMark}${m[1]}` : (r.memo && r.memo.includes("취급") ? "취급" : shiftMark);
                          return (
                            <div key={i} style={{ background: c.bg, borderRadius: 5, padding: "2px 3px" }}>
                              <div style={{ fontSize: 9, color: c.fg, fontWeight: 600, lineHeight: 1.3, textAlign: "center" }}>
                                {LABEL[r.adjust_type] || r.adjust_type}
                              </div>
                              <div style={{ fontSize: 9, color: c.fg, lineHeight: 1.3, textAlign: "center" }}>
                                {sub}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                {(() => {
                    const dstr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const lv = leaveRecords.filter((r) => r.used_date === dstr);
                    if (lv.length === 0) return null;
                    const LV: Record<string, string> = {
                      annual: "연차", tempAnnual: "가연차", promotedAnnual: "촉진연차",
                      substitute: "대체", study: "학습", longService: "장기재직",
                    };
                    return (
                      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                        {lv.map((r, i) => (
                          <div key={`lv${i}`} style={{ background: "#EEF0FF", borderRadius: 5, padding: "2px 3px" }}>
                            <div style={{ fontSize: 9, color: "#4F46E5", fontWeight: 600, lineHeight: 1.3, textAlign: "center" }}>
                              {LV[r.leave_type] || r.leave_type}
                            </div>
                            <div style={{ fontSize: 9, color: "#4F46E5", lineHeight: 1.3, textAlign: "center" }}>
                              {r.days}일
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}  
                </div>
              );
            })}
          </div>
        ))}
         </div>
    );
  };
  // ─── 전체 조 보기 (A/B/C/D 한눈에 비교) ───
  const renderAllCrews = () => {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    const crews: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
    const LABEL: Record<string, string> = {
      주: "주간",
      야: "야간",
      비: "비번",
      휴: "휴무",
    };
    const COLOR: Record<string, string> = {
      주: "#3B82F6",
      야: "#7C3AED",
      비: "#9CA3AF",
      휴: "#92400E",
    };
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

    return (
      <div style={{ padding: "12px 16px" }}>
        <div
          style={{
            overflowX: "auto",
            borderRadius: 8,
            border: "1px solid #E5E7EB",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              background: "#fff",
            }}
          >
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th
                  style={{
                    padding: "8px 4px",
                    borderBottom: "1px solid #E5E7EB",
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  날짜
                </th>
                {crews.map((c) => (
                  <th
                    key={c}
                    style={{
                      padding: "8px 4px",
                      borderBottom: "1px solid #E5E7EB",
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {c}조
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const date = new Date(currentYear, currentMonth - 1, d);
                const dow = date.getDay();
                const dateColor =
                  dow === 0 ? "#DC2626" : dow === 6 ? "#2563EB" : "#374151";
                return (
                  <tr key={d} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td
                      style={{
                        padding: "8px 4px",
                        textAlign: "center",
                        fontWeight: 600,
                        color: dateColor,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        const works = crews.map((c) => ({
                          crew: c,
                          work: getShiftWork(c, date),
                        }));
                        setDayDetail({ date, works });
                      }}
                    >
                      {currentMonth}/{d}
                      <span
                        style={{
                          fontSize: 10,
                          color: "#9CA3AF",
                          marginLeft: 4,
                        }}
                      >
                        ({dayNames[dow]})
                      </span>
                    </td>
                    {crews.map((c) => {
                      const work = getShiftWork(c, date);
                      const info = work ? workInfo(work) : null;
                      return (
                        <td
                          key={c}
                          style={{ padding: "8px 4px", textAlign: "center" }}
                        >
                          {info ? (
                            <span
                              style={{
                                color: COLOR[info.short] || "#6B7280",
                                fontWeight: 600,
                                fontSize: 12,
                              }}
                            >
                              {LABEL[info.short] || info.short}
                            </span>
                          ) : (
                            <span style={{ color: "#D1D5DB" }}>-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {dayDetail && (
            <div
              onClick={() => setDayDetail(null)}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 100,
                padding: 20,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  width: "100%",
                  maxWidth: 320,
                  padding: "20px 20px 16px",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
                }}
              >
                <div
                  style={{
                    textAlign: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    marginBottom: 16,
                    color: "#111827",
                  }}
                >
                  {dayDetail.date.getMonth() + 1}월 {dayDetail.date.getDate()}일
                  ({dayNames[dayDetail.date.getDay()]})
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  {dayDetail.works.map((w: any) => {
                    const info = w.work ? workInfo(w.work) : null;
                    return (
                      <div
                        key={w.crew}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "10px 14px",
                          background: "#F9FAFB",
                          borderRadius: 10,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: "#374151",
                          }}
                        >
                          {w.crew}조
                        </span>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: info
                              ? COLOR[info.short] || "#6B7280"
                              : "#D1D5DB",
                          }}
                        >
                          {info ? LABEL[info.short] || info.short : "-"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => setDayDetail(null)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    background: "#4F46E5",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  확인
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      {/* 헤더 */}
            {/* 헤더 (흰 배너) */}
      <div
        style={{
          background: "#fff",
          padding: "calc(env(safe-area-inset-top) + 14px) 16px 14px",
          borderBottom: "1px solid #EEF0F3",
        }}
      >
        <div
          style={{
            textAlign: "center",
            fontSize: 16,
            fontWeight: 800,
            color: "#4F46E5",
            letterSpacing: "-0.3px",
          }}
        >
          {now.getFullYear()}년 {now.getMonth() + 1}월 {now.getDate()}일{" "}
          {["일", "월", "화", "수", "목", "금", "토"][now.getDay()]}요일{" "}
          {String(now.getHours()).padStart(2, "0")}:
          {String(now.getMinutes()).padStart(2, "0")}:
          {String(now.getSeconds()).padStart(2, "0")}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginTop: 5,
          }}
        >
          <span style={{ fontSize: 12, color: "#6B7280" }}>
            사용자 : <b style={{ color: "#1F2937" }}>{user?.name}</b>
            {user?.work_group ? ` ( ${user.work_group} )` : ""}
          </span>
          <button
            onClick={() => {
              setSelectedGroup(null);
              setSelectedMember(null);
              setSelectedCrew(null);
            }}
            style={{
              background: "#EEF2FF",
              border: "none",
              color: "#6366F1",
              fontSize: 12,
              cursor: "pointer",
              padding: "3px 11px",
              borderRadius: 999,
              fontFamily: "inherit",
            }}
          >
            메뉴화면
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 14,
          }}
        >
          <button
            onClick={() => {
              const p = getPrevMonth(currentYear, currentMonth);
              setCurrentYear(p.y);
              setCurrentMonth(p.m);
            }}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "#F3F4F6",
              border: "none",
              color: "#6B7280",
              fontSize: 14,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ‹
          </button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2937" }}>
              {currentYear}년 {currentMonth}월
            </div>
          </div>
          <button
            onClick={() => {
              const n = getNextMonth(currentYear, currentMonth);
              setCurrentYear(n.y);
              setCurrentMonth(n.m);
            }}
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "#F3F4F6",
              border: "none",
              color: "#6B7280",
              fontSize: 14,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ›
          </button>
        </div>
      </div>

      <div style={{ background: "#fff", minHeight: "80vh" }}>
        {activeTab === "교대" && (
          <>
            {!crewLoaded && (
              <div
                style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}
              >
                불러오는 중...
              </div>
            )}
            {crewLoaded && !selectedCrew && renderCrewSelect()}
            {crewLoaded && selectedCrew && shiftViewMode === "crew" && (
              <>     
                {renderSlideCalendar(selectedCrew)}
              </>
            )}
            {crewLoaded && shiftViewMode === "all" && renderAllCrews()}
          </>
        )}
        {activeTab === "교번" && renderKyobunTab()}
        {activeTab === "통상" && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "#9CA3AF",
              fontSize: 14,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🚧</div>통상 근무표
            준비 중
          </div>
        )}
        {activeTab === "변형통상" && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "#9CA3AF",
              fontSize: 14,
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🚧</div>변형통상
            근무표 준비 중
          </div>
        )}
      </div>
    </div>
  );
}
function MySettingsScreen({
  onBack,
  user,
  notifSettings,
  setNotifSettings,
  onLogout,
  refreshUser,
}) {
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [editName, setEditName] = useState(user?.name || "");
  const [editEmpId] = useState(user?.emp_id || "");
  const [editPhone, setEditPhone] = useState(user?.phone || "");
  const [profileSaved, setProfileSaved] = useState(false);

  // 근무정보 입력 상태
  const [editWorkType, setEditWorkType] = useState(user?.work_type || "");
  const [editWorkGroup, setEditWorkGroup] = useState(user?.work_group || "");
  const [editGrade, setEditGrade] = useState<number | null>(
    user?.grade ?? null
  );
  const [editPayStep, setEditPayStep] = useState<number | null>(
    user?.pay_step ?? null
  );
  const [editAddPayStep, setEditAddPayStep] = useState(
    user?.add_pay_step || ""
  );
  const [addPayStepSaved, setAddPayStepSaved] = useState(!!user?.add_pay_step);
  const [addPayStepLocked, setAddPayStepLocked] = useState(
    !!user?.add_pay_step
  );
  const [showAddPayStepEdit, setShowAddPayStepEdit] = useState(false);
  const [showAddPayStepInfo, setShowAddPayStepInfo] = useState(false);
  const [editJoinDate, setEditJoinDate] = useState(user?.join_date || "");
  const [editBirthYear, setEditBirthYear] = useState(user?.birth_year || "");
  const [editPayStepNextDate, setEditPayStepNextDate] = useState(
    user?.pay_step_next_date || ""
  );
  const [editJoinYear, setEditJoinYear] = useState(user?.join_year || "");
  const [joinConsent, setJoinConsent] = useState(user?.join_date ? true : null);
  const [birthConsent, setBirthConsent] = useState(
    user?.birth_year ? true : null
  );
  const [showJoinConsentModal, setShowJoinConsentModal] = useState(false);
  const [showBirthConsentModal, setShowBirthConsentModal] = useState(false);
  const [workSaved, setWorkSaved] = useState(false);
  const [savedWorkData, setSavedWorkData] = useState(null);
  const workTypes = ["교대", "교번", "통상", "변형통상"];
  const [editMode, setEditMode] = useState(!(user?.work_type));
  const [editNotify, setEditNotify] = useState(false);
  // 화면 진입 시 DB에서 최신 user 정보 다시 가져오기
  React.useEffect(() => {
    if (!user?.employee_number) return;
    (async () => {
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .eq("employee_number", user.employee_number)
        .maybeSingle();
      if (error) {
        console.log("user 정보 가져오기 실패:", error);
        return;
      }
      if (data) {
        console.log("DB에서 가져온 최신 user:", data);
        if (data.work_type) setEditWorkType(data.work_type);
        if (data.work_group) setEditWorkGroup(data.work_group);
        if (data.grade) setEditGrade(data.grade);
        if (data.pay_step) setEditPayStep(data.pay_step);
        if (data.pay_step_next_date)
          setEditPayStepNextDate(data.pay_step_next_date);
        if (data.join_year) setEditJoinYear(data.join_year);
        if (data.birth_year) setEditBirthYear(data.birth_year);
        if (data.phone) setEditPhone(data.phone);

        // 🤖 자동 호봉 승급 체크
        if (data.pay_step && data.pay_step_next_date) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          let currentStep = Number(data.pay_step);
          let nextDate = new Date(data.pay_step_next_date);
          let changed = false;

          // 다음 승급일이 오늘이거나 지났고, 40호봉 미만이면 승급
          while (today >= nextDate && currentStep < 40) {
            currentStep += 1;
            nextDate.setFullYear(nextDate.getFullYear() + 1);
            changed = true;
          }

          if (changed) {
            const newNextDate = nextDate.toISOString().slice(0, 10);
            setEditPayStep(currentStep);
            setEditPayStepNextDate(newNextDate);
            // DB에도 저장
            await supabase
              .from("members")
              .update({
                pay_step: currentStep,
                pay_step_next_date: currentStep >= 40 ? null : newNextDate,
              })
              .eq("employee_number", user.employee_number);
            console.log(`자동 승급: ${data.pay_step}호봉 → ${currentStep}호봉`);
          }
        }
      }
    })();
  }, []);
  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      {/* 로그아웃 확인 모달 */}
      {showLogoutModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            padding: 24,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "28px 24px",
              width: "100%",
              maxWidth: 360,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>👋</div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "#1F2937",
                marginBottom: 8,
              }}
            >
              로그아웃
            </div>
            <div
              style={{
                fontSize: 14,
                color: "#6B7280",
                lineHeight: 1.7,
                marginBottom: 24,
              }}
            >
              로그아웃 하시겠습니까?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowLogoutModal(false)}
                style={{
                  flex: 1,
                  padding: "13px",
                  background: "#F3F4F6",
                  color: "#6B7280",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowLogoutModal(false);
                  onLogout();
                }}
                style={{
                  flex: 1,
                  padding: "13px",
                  background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 앱 탈퇴 확인 모달 */}
      {showWithdrawModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            padding: 24,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "28px 24px",
              width: "100%",
              maxWidth: 360,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "#EF4444",
                marginBottom: 8,
              }}
            >
              앱 탈퇴
            </div>
            <div
              style={{
                fontSize: 14,
                color: "#6B7280",
                lineHeight: 1.7,
                marginBottom: 12,
              }}
            >
              정말 탈퇴하시겠습니까?
            </div>
            <div
              style={{
                background: "#FEE2E2",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 24,
                fontSize: 12,
                color: "#EF4444",
                lineHeight: 1.7,
                textAlign: "left",
              }}
            >
              ⚠️ 탈퇴 즉시 모든 개인정보 및 데이터는
              <br />
              <strong>복구 불능으로 즉시 폐기</strong>됩니다.
              <br />
              재가입 시 관리자 승인을 다시 받아야 합니다.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setShowWithdrawModal(false)}
                style={{
                  flex: 1,
                  padding: "13px",
                  background: "#F3F4F6",
                  color: "#6B7280",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  setShowWithdrawModal(false);
                  onLogout();
                }}
                style={{
                  flex: 1,
                  padding: "13px",
                  background: "#EF4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                탈퇴하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 헤더 */}
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 28px",
          borderRadius: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              대공원승무지회
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              행복한 하루 되세요!!
            </div>
          </div>
        </div>
        {/* 프로필 카드 */}
        <div
          style={{
            background: "rgba(255,255,255,0.15)",
            borderRadius: 18,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon
              path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              color="#fff"
              size={26}
            />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: "#fff" }}>
              {user?.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.75)",
                marginTop: 3,
              }}
            >
              {user?.is_admin ? "⚙️ 관리자" : "조합원"} ·{" "}
              {user?.work_type || "대공원승무지회"}
            </div>
          </div>
          {user?.is_admin && (
            <div
              style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,0.2)",
                borderRadius: 8,
                padding: "4px 10px",
              }}
            >
              <span style={{ fontSize: 11, color: "#fff", fontWeight: 700 }}>
                관리자
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        {/* 프로필 수정 */}
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 12,
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#1F2937",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 4,
                height: 18,
                background: "#4F46E5",
                borderRadius: 2,
              }}
            />
            프로필 수정
          </div>

          {/* 이름 - 수정 불가 */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 12, color: "#9CA3AF" }}>이름</div>
              <div style={{ fontSize: 10, color: "#9CA3AF" }}>
                🔒 조합원 명단 기준
              </div>
            </div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "#F8F7FF",
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                color: "#6B7280",
              }}
            >
              {editName}
            </div>
          </div>

          {/* 사번 - 수정 불가 */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 12, color: "#9CA3AF" }}>사번</div>
              <div style={{ fontSize: 10, color: "#9CA3AF" }}>
                🔒 조합원 명단 기준
              </div>
            </div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "#F8F7FF",
                border: "1.5px solid #E5E7EB",
                fontSize: 14,
                color: "#6B7280",
              }}
            >
              {editEmpId || "정보 없음"}
            </div>
          </div>

          {/* 연락처 - 수정 가능 */}
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 12, color: "#9CA3AF" }}>연락처</div>
              {editPhone ? (
                <div
                  style={{
                    fontSize: 10,
                    background: "#D1FAE5",
                    color: "#059669",
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 6,
                  }}
                >
                  ✓ 저장됨
                </div>
              ) : (
                <div
                  style={{ fontSize: 10, color: "#4F46E5", fontWeight: 600 }}
                >
                  ✏️ 수정 가능
                </div>
              )}
            </div>
            <input
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="010-0000-0000"
              type="tel"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1.5px solid #4F46E5",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
                color: "#1F2937",
              }}
            />
          </div>

          <div
            style={{
              background: "#EEF0FF",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 11,
              color: "#4F46E5",
              lineHeight: 1.6,
            }}
          >
            💡 이름·사번은 지회 조합원 명단 기준으로 자동 설정됩니다.
            <br />
            연락처는 여기서 수정하면 조합원 명단에도 반영됩니다.
          </div>

          {profileSaved && (
            <div
              style={{
                background: "#D1FAE5",
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 12,
                fontSize: 13,
                color: "#10B981",
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              ✅ 연락처가 저장되었습니다!
            </div>
          )}
          <button
            onClick={async () => {
              // 빈 칸 체크 + 기존 값 삭제 시 확인
              if (!editPhone || !editPhone.trim()) {
                if (user?.phone) {
                  if (!window.confirm("저장된 연락처를 삭제하시겠습니까?")) {
                    return;
                  }
                } else {
                  alert("연락처를 입력해주세요.");
                  return;
                }
              } else {
                // 휴대폰 번호 형식 체크 (010-XXXX-XXXX)
                const phoneCheck = editPhone.replace(/[^0-9]/g, "");
                if (!/^01[0-9]{8,9}$/.test(phoneCheck)) {
                  alert(
                    "올바른 휴대폰 번호 형식이 아닙니다.\n예: 010-1234-5678"
                  );
                  return;
                }
              }

              // 진짜 저장 (Supabase에 업데이트)
              if (user?.employee_number) {
                const { error } = await supabase
                  .from("members")
                  .update({ phone: editPhone.trim() })
                  .eq("employee_number", user.employee_number);
                if (error) {
                  alert("저장 실패: " + error.message);
                  return;
                }
              }
              setProfileSaved(true);
              setTimeout(() => setProfileSaved(false), 2000);
            }}
            style={{
              width: "100%",
              padding: "13px",
              background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            연락처 저장하기
          </button>
        </div>

        {/* 비밀번호 변경 */}
        <PwChangeSection user={user} />

        {/* 포인트 현황 */}
        <PointSection user={user} />

        {/* 근무정보 */}
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 12,
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#1F2937",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 4,
                height: 18,
                background: "#4F46E5",
                borderRadius: 2,
              }}
            />
            근무 정보
          </div>
{editMode && (<>
          {/* 근무 유형 */}
          {[
            {
              label: "근무 유형",
              icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
              color: "#4F46E5",
              bg: "#EEF0FF",
              content: (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  {["교대", "교번", "통상", "변형통상"].map((w) => (
                    <button
                      key={w}
                      onClick={() => {
                        setEditWorkType(w);
                        setEditWorkGroup("");
                      }}
                      style={{
                        padding: "10px",
                        borderRadius: 10,
                        border: "1.5px solid",
                        borderColor: editWorkType === w ? "#4F46E5" : "#E5E7EB",
                        background: editWorkType === w ? "#EEF0FF" : "#fff",
                        color: editWorkType === w ? "#4F46E5" : "#6B7280",
                        fontSize: 13,
                        fontWeight: editWorkType === w ? 700 : 400,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              ),
            },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid #F3F4F6",
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: item.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <Icon path={item.icon} color={item.color} size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 8 }}
                >
                  {item.label}
                </div>
                {item.content}
              </div>
            </div>
          ))}

          {/* 교대 선택 시 조 선택 */}
          {editWorkType === "교대" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid #F3F4F6",
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "#E0F2FE",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <Icon
                  path="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  color="#0EA5E9"
                  size={18}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 8 }}
                >
                  조
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 8,
                  }}
                >
                  {["A", "B", "C", "D"].map((g) => (
                    <button
                      key={g}
                      onClick={() => setEditWorkGroup(g)}
                      style={{
                        padding: "10px",
                        borderRadius: 10,
                        border: "1.5px solid",
                        borderColor:
                          editWorkGroup === g ? "#0EA5E9" : "#E5E7EB",
                        background: editWorkGroup === g ? "#E0F2FE" : "#fff",
                        color: editWorkGroup === g ? "#0EA5E9" : "#6B7280",
                        fontSize: 13,
                        fontWeight: editWorkGroup === g ? 700 : 400,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {g}조
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 교번 선택 시 소속 선택 */}
          {editWorkType === "교번" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 0",
                borderBottom: "1px solid #F3F4F6",
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "#E0F2FE",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <Icon
                  path="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
                  color="#0EA5E9"
                  size={18}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 8 }}
                >
                  소속
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: 8,
                  }}
                >
                  {["대공원", "도봉"].map((b) => (
                    <button
                      key={b}
                      onClick={() => setEditWorkGroup(b)}
                      style={{
                        padding: "10px",
                        borderRadius: 10,
                        border: "1.5px solid",
                        borderColor:
                          editWorkGroup === b ? "#0EA5E9" : "#E5E7EB",
                        background: editWorkGroup === b ? "#E0F2FE" : "#fff",
                        color: editWorkGroup === b ? "#0369A1" : "#6B7280",
                        fontSize: 13,
                        fontWeight: editWorkGroup === b ? 700 : 400,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* 직급 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 0",
              borderBottom: "1px solid #F3F4F6",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "#D1FAE5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon
                path="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                color="#10B981"
                size={18}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 6 }}>
                직급
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: 6,
                }}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((g) => (
                  <button
                    key={g}
                    onClick={() => setEditGrade(g)}
                    style={{
                      padding: "10px 0",
                      borderRadius: 10,
                      border:
                        Number(editGrade) === g
                          ? "2px solid #4F46E5"
                          : "1.5px solid #E5E7EB",
                      background: Number(editGrade) === g ? "#4F46E5" : "#fff",
                      color: Number(editGrade) === g ? "#fff" : "#1F2937",
                      fontWeight: Number(editGrade) === g ? 700 : 500,
                      fontSize: 14,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {g}급
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 호봉 - 입사년월일 동의 여부에 따라 분기 */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 0",
              borderBottom: "1px solid #F3F4F6",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "#FEF3C7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 900, color: "#F59E0B" }}>
                ₩
              </span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 6 }}>
                호봉
              </div>

              <div>
                {/* 안내 박스 */}
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "#EEF0FF",
                    fontSize: 13,
                    color: "#4F46E5",
                    fontWeight: 600,
                    marginBottom: 10,
                  }}
                >
                  💡 호봉 정보를 직접 입력하세요
                </div>

                {/* 현재 호봉 + 다음 승급일 (가로) */}
                <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6B7280",
                        marginBottom: 4,
                        fontWeight: 600,
                      }}
                    >
                      현재 호봉
                    </div>
                    <select
                      value={editPayStep}
                      onChange={(e) => setEditPayStep(Number(e.target.value))}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid #E5E7EB",
                        fontSize: 14,
                        outline: "none",
                        boxSizing: "border-box",
                        fontFamily: "inherit",
                        color: "#1F2937",
                        background: "#fff",
                      }}
                    >
                      <option value="">호봉 선택</option>
                      {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}호봉
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 다음 승급일 */}
                  <div style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6B7280",
                        marginBottom: 4,
                        fontWeight: 600,
                      }}
                    >
                      다음 승급일
                    </div>
                    <input
                      type="date"
                      value={editPayStepNextDate}
                      onChange={(e) => setEditPayStepNextDate(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid #E5E7EB",
                        fontSize: 14,
                        outline: "none",
                        boxSizing: "border-box",
                        fontFamily: "inherit",
                        color: "#1F2937",
                        background: "#fff",
                        WebkitAppearance: "none",
                        appearance: "none",
                      }}
                    />
                    <style>{`
                      input[type="date"]::-webkit-calendar-picker-indicator {
                        display: none;
                        -webkit-appearance: none;
                      }
                    `}</style>
                  </div>
                </div>

                {/* 자동 승급 안내 */}
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#F0FDF4",
                    border: "1px solid #BBF7D0",
                    fontSize: 11,
                    color: "#059669",
                    lineHeight: 1.5,
                    marginBottom: 10,
                  }}
                >
                  ℹ️ 다음 승급일이 지나면 자동으로 +1호봉 됩니다
                </div>

                {/* 입사년도 */}

                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6B7280",
                      marginBottom: 4,
                      fontWeight: 600,
                    }}
                  >
                    입사년도
                  </div>
                  <input
                    value={editJoinYear}
                    onChange={(e) =>
                      setEditJoinYear(
                        e.target.value.replace(/[^0-9]/g, "").slice(0, 4)
                      )
                    }
                    placeholder="예: 2007"
                    type="tel"
                    maxLength={4}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid #E5E7EB",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      color: "#1F2937",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 입사년월일 동의 모달 */}

          {showJoinConsentModal && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 999,
                padding: 20,
              }}
            >
              <div
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  padding: "28px 24px",
                  width: "100%",
                  maxWidth: 380,
                }}
              >
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: "50%",
                      background: "#EEF0FF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 12px",
                    }}
                  >
                    <Icon
                      path="M6 3v18M12 3v18M18 3v18M6 8c1.5 0 3-1 3-2.5M6 13c2 0 3.5-1 3.5-2.5M12 7c1.5 0 3-1 3-2.5M12 12c2 0 3.5-1 3.5-2.5M18 9c-1.5 0-3-1-3-2.5M18 14c-2 0-3.5-1-3.5-2.5"
                      color="#4F46E5"
                      size={24}
                    />
                  </div>
                  <div
                    style={{ fontSize: 16, fontWeight: 800, color: "#1F2937" }}
                  >
                    개인정보 수집 · 이용 동의
                  </div>
                </div>
                <div
                  style={{
                    background: "#F8F7FF",
                    borderRadius: 14,
                    padding: "16px",
                    marginBottom: 20,
                    fontSize: 13,
                    lineHeight: 1.9,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#4F46E5",
                      marginBottom: 6,
                    }}
                  >
                    📋 수집 항목
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      marginBottom: 14,
                      paddingLeft: 4,
                    }}
                  >
                    입사년월일
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#4F46E5",
                      marginBottom: 6,
                    }}
                  >
                    🎯 수집 목적
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      marginBottom: 4,
                      paddingLeft: 4,
                    }}
                  >
                    1. 복잡한 수당 및 호봉의 자동계산을 통한 이용 편의 제공
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      marginBottom: 4,
                      paddingLeft: 4,
                    }}
                  >
                    2. 근속연수 기반 급여·수당 계산 서비스 제공
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      marginBottom: 14,
                      paddingLeft: 4,
                    }}
                  >
                    3. 연차 및 기타휴가 자동 계산 서비스 제공
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#4F46E5",
                      marginBottom: 6,
                    }}
                  >
                    🗓️ 보유 기간
                  </div>
                  <div style={{ color: "#374151", paddingLeft: 4 }}>
                    노동조합 및 앱 탈퇴 시 즉시 파기
                  </div>
                </div>
                <div
                  style={{
                    background: "#FEF3C7",
                    borderRadius: 10,
                    padding: "10px 14px",
                    marginBottom: 20,
                    fontSize: 12,
                    color: "#92400E",
                    lineHeight: 1.6,
                  }}
                >
                  ⚠️ 동의하지 않으셔도 서비스 이용이 가능합니다.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      setJoinConsent(false);
                      setEditJoinDate("");
                      setShowJoinConsentModal(false);
                    }}
                    style={{
                      flex: 1,
                      padding: "13px",
                      background: "#F3F4F6",
                      color: "#6B7280",
                      border: "none",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    동의 안함
                  </button>
                  <button
                    onClick={() => {
                      setJoinConsent(true);
                      setShowJoinConsentModal(false);
                    }}
                    style={{
                      flex: 1,
                      padding: "13px",
                      background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                      color: "#fff",
                      border: "none",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    동의합니다
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* 출생연도 동의 모달 */}
          {showBirthConsentModal && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 999,
                padding: 20,
              }}
            >
              <div
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  padding: "28px 24px",
                  width: "100%",
                  maxWidth: 380,
                }}
              >
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: "50%",
                      background: "#EEF0FF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 12px",
                    }}
                  >
                    <Icon
                      path="M6 3v18M12 3v18M18 3v18M6 8c1.5 0 3-1 3-2.5M6 13c2 0 3.5-1 3.5-2.5M12 7c1.5 0 3-1 3-2.5M12 12c2 0 3.5-1 3.5-2.5M18 9c-1.5 0-3-1-3-2.5M18 14c-2 0-3.5-1-3.5-2.5"
                      color="#4F46E5"
                      size={24}
                    />
                  </div>
                  <div
                    style={{ fontSize: 16, fontWeight: 800, color: "#1F2937" }}
                  >
                    개인정보 수집 · 이용 동의
                  </div>
                </div>
                <div
                  style={{
                    background: "#F8F7FF",
                    borderRadius: 14,
                    padding: "16px",
                    marginBottom: 20,
                    fontSize: 13,
                    lineHeight: 1.9,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#4F46E5",
                      marginBottom: 6,
                    }}
                  >
                    📋 수집 항목
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      marginBottom: 14,
                      paddingLeft: 4,
                    }}
                  >
                    출생연도
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#4F46E5",
                      marginBottom: 6,
                    }}
                  >
                    🎯 수집 목적
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      marginBottom: 4,
                      paddingLeft: 4,
                    }}
                  >
                    1. 지회 세대별 구성 통계 산출 및 시각화
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      marginBottom: 14,
                      paddingLeft: 4,
                    }}
                  >
                    2. 60세 정년퇴직 예정자 안내 및 축하 서비스 제공
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: "#4F46E5",
                      marginBottom: 6,
                    }}
                  >
                    🗓️ 보유 기간
                  </div>
                  <div style={{ color: "#374151", paddingLeft: 4 }}>
                    노동조합 및 앱 탈퇴 시 즉시 파기
                  </div>
                </div>
                <div
                  style={{
                    background: "#FEF3C7",
                    borderRadius: 10,
                    padding: "10px 14px",
                    marginBottom: 20,
                    fontSize: 12,
                    color: "#92400E",
                    lineHeight: 1.6,
                  }}
                >
                  ⚠️ 동의하지 않으셔도 서비스 이용이 가능합니다.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      setBirthConsent(false);
                      setEditBirthYear("");
                      setShowBirthConsentModal(false);
                    }}
                    style={{
                      flex: 1,
                      padding: "13px",
                      background: "#F3F4F6",
                      color: "#6B7280",
                      border: "none",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    동의 안함
                  </button>
                  <button
                    onClick={() => {
                      setBirthConsent(true);
                      setShowBirthConsentModal(false);
                    }}
                    style={{
                      flex: 1,
                      padding: "13px",
                      background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
                      color: "#fff",
                      border: "none",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    동의합니다
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 출생연도 동의 UI */}
          <div style={{ marginTop: 12 }}>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>출생연도</div>
                <button
                  onClick={() => setShowBirthConsentModal(true)}
                  style={{
                    fontSize: 10,
                    color: "#4F46E5",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  동의 보기
                </button>
              </div>
              {birthConsent === null && (
                <button
                  onClick={() => setShowBirthConsentModal(true)}
                  style={{
                    width: "100%",
                    padding: "10px 8px",
                    borderRadius: 10,
                    border: "1.5px dashed #C7D2FE",
                    background: "#F8F7FF",
                    color: "#9CA3AF",
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "center",
                  }}
                >
                  🔒 동의 후 입력
                </button>
              )}
              {birthConsent === false && (
                <div
                  style={{
                    padding: "10px 8px",
                    borderRadius: 10,
                    background: "#F3F4F6",
                    fontSize: 11,
                    color: "#9CA3AF",
                    textAlign: "center",
                  }}
                >
                  미동의
                </div>
              )}
              {birthConsent === true && (
                <input
                  value={editBirthYear}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
                    setEditBirthYear(v);
                  }}
                  placeholder="예: 791111"
                  type="tel"
                  maxLength={6}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1.5px solid #4F46E5",
                    fontSize: 12,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#1F2937",
                  }}
                />
              )}
            </div>
          </div>

          {workSaved && (
            <div
              style={{
                background: "#D1FAE5",
                borderRadius: 10,
                padding: "10px 14px",
                marginTop: 12,
                fontSize: 13,
                color: "#10B981",
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              ✅ 근무정보가 저장되었습니다!
            </div>
          )}
          <button
            onClick={async () => {
              setSavedWorkData({
                workType: editWorkType,
                workGroup: editWorkGroup,
                grade: editGrade,
                payStep: editPayStep,
                payStepNextDate: editPayStepNextDate,
                joinYear: editJoinYear,
                birthYear: editBirthYear,
                birthConsent,
              });
              // Supabase에 진짜 저장 (로그 포함)
              console.log("저장 시도:", {
                user,
                editWorkType,
                editWorkGroup,
                editGrade,
                editPayStep,
                editPayStepNextDate,
                editJoinYear,
              });
              if (user?.employee_number) {
                const { data, error } = await supabase
                  .from("members")
                  .update({
                    work_type: editWorkType,
                    work_group: editWorkGroup,
                    grade: editGrade,
                    pay_step: editPayStep || null,
                    pay_step_next_date: editPayStepNextDate || null,
                    join_year: editJoinYear || null,
                    birth_year: editBirthYear || null,
                  })
                  .eq("employee_number", user.employee_number)
                  .select();
                console.log("저장 결과:", { data, error });
                if (error) {
                  alert("저장 실패: " + error.message);
                } else {
                  await refreshUser();
                }
              } else {
                console.log("employee_number 없음 - 저장 안 함");
                alert("로그인 정보 없음 - 저장 안 됨");
              }
              setWorkSaved(true);
              setEditMode(false);
              setTimeout(() => setWorkSaved(false), 2000);
            }}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "13px",
              background: "linear-gradient(135deg, #4F46E5, #6D28D9)",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            근무정보 저장하기
          </button>
</>)}

          {!editMode && (
            <div>
              {[
                { label: "근무 유형", value: (editWorkType || "-") + (editWorkGroup ? ` · ${editWorkGroup}조` : "") },
                { label: "직급", value: editGrade ? `${editGrade}급` : "-" },
                { label: "현재 호봉", value: editPayStep ? `${editPayStep}호봉` : "-" },
                { label: "다음 승급일", value: editPayStepNextDate || "-" },
                { label: "입사년도", value: editJoinYear || "-" },
                { label: "출생연도", value: editBirthYear || "-" },
              ].map((it, i, arr) => (
                <div key={it.label} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                  <span style={{ fontSize: 13, color: "#6B7280" }}>{it.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>{it.value}</span>
                </div>
              ))}
              <button
                onClick={() => setEditMode(true)}
                style={{ width: "100%", marginTop: 16, padding: "12px", background: "#fff", color: "#4F46E5", border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                ✏️ 수정하기
              </button>
            </div>
          )}
          {/* 저장 후 실시간 현시 */}
         {editMode && savedWorkData && (
            <div
              style={{
                marginTop: 16,
                background: "#F0FDF4",
                borderRadius: 16,
                padding: "18px",
                border: "1.5px solid #BBF7D0",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#10B981",
                  marginBottom: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ✅ 저장된 근무 정보
              </div>
              <div
                style={{
                  marginTop: 12,
                }}
              >
                {[
                  {
                    label: "근무유형",
                    value:
                      savedWorkData.workType +
                      (savedWorkData.workGroup
                        ? ` ${savedWorkData.workGroup}조`
                        : ""),
                  },
                  { label: "직급", value: savedWorkData.grade },
                  {
                    label: "입사년월일",
                    value:
                      savedWorkData.joinConsent === true &&
                      savedWorkData.joinDate
                        ? `${savedWorkData.joinDate.slice(
                            0,
                            4
                          )}.${savedWorkData.joinDate.slice(
                            4,
                            6
                          )}.${savedWorkData.joinDate.slice(6, 8)}`
                        : "미제공",
                  },
                  {
                    label: "출생연도",
                    value:
                      savedWorkData.birthConsent === true &&
                      savedWorkData.birthYear
                        ? savedWorkData.birthYear
                        : "미제공",
                  },
                ].map((item, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#fff",
                      borderRadius: 10,
                      padding: "10px 12px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "#9CA3AF",
                        marginBottom: 3,
                      }}
                    >
                      {item.label}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#1F2937",
                      }}
                    >
                      {item.value || "—"}
                    </div>
                  </div>
                ))}
              </div>
              {savedWorkData.calc && (
                <div
                  style={{
                    marginTop: 10,
                    background: "#fff",
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 8 }}
                  >
                    호봉 산정 결과
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#6B7280" }}>근속</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#1F2937",
                      }}
                    >
                      {savedWorkData.calc.years}년 {savedWorkData.calc.months}
                      개월
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#6B7280" }}>
                      기본 호봉 (자동산정)
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#10B981",
                      }}
                    >
                      {savedWorkData.calc.payStep}호봉
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#6B7280" }}>
                      가산 호봉
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#4F46E5",
                      }}
                    >
                      +{parseInt(savedWorkData.addPayStep || "0")}호봉
                    </span>
                  </div>
                  <div
                    style={{
                      borderTop: "1px solid #BBF7D0",
                      marginTop: 6,
                      paddingTop: 8,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#1F2937",
                        }}
                      >
                        현재 호봉
                      </span>
                      {savedWorkData.calc.payStep +
                        parseInt(savedWorkData.addPayStep || "0") >=
                        40 && (
                        <span
                          style={{
                            background: "#fbbf24",
                            color: "#92400e",
                            fontSize: 10,
                            fontWeight: 700,
                            borderRadius: 6,
                            padding: "2px 6px",
                          }}
                        >
                          최고 🏆
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 900,
                        color: "#10B981",
                      }}
                    >
                      {Math.min(
                        savedWorkData.calc.payStep +
                          parseInt(savedWorkData.addPayStep || "0"),
                        40
                      )}
                      호봉
                    </span>
                  </div>
                </div>
              )}
              {savedWorkData.joinConsent === false && (
                <div
                  style={{
                    marginTop: 10,
                    background: "#fff",
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 8 }}
                  >
                    호봉 산정 결과
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#6B7280" }}>
                      직접 입력 호봉
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#F59E0B",
                      }}
                    >
                      {parseInt(savedWorkData.payStep || "0")}호봉
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#6B7280" }}>
                      가산 호봉
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#4F46E5",
                      }}
                    >
                      +{parseInt(savedWorkData.addPayStep || "0")}호봉
                    </span>
                  </div>
                  <div
                    style={{
                      borderTop: "1px solid #FDE68A",
                      marginTop: 6,
                      paddingTop: 8,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#1F2937",
                        }}
                      >
                        현재 호봉
                      </span>
                      {parseInt(savedWorkData.payStep || "0") +
                        parseInt(savedWorkData.addPayStep || "0") >=
                        40 && (
                        <span
                          style={{
                            background: "#fbbf24",
                            color: "#92400e",
                            fontSize: 10,
                            fontWeight: 700,
                            borderRadius: 6,
                            padding: "2px 6px",
                          }}
                        >
                          최고 🏆
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 900,
                        color: "#F59E0B",
                      }}
                    >
                      {Math.min(
                        parseInt(savedWorkData.payStep || "0") +
                          parseInt(savedWorkData.addPayStep || "0"),
                        40
                      )}
                      호봉
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 알림 설정 */}
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 12,
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#1F2937",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 4,
                height: 18,
                background: "#4F46E5",
                borderRadius: 2,
              }}
            />
            알림 설정
          </div>
      {!editNotify && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F9FAFB", borderRadius: 12, padding: "14px 16px", marginBottom: 14 }}>
                <span style={{ fontSize: 13, color: "#6B7280" }}>받는 중인 알림</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#4F46E5" }}>
                  {["urgentNotice", "agreement", "board", "vote", "inquiry"].filter((k) => notifSettings[k]).length}개 켜짐
                </span>
              </div>
              <button
                onClick={() => setEditNotify(true)}
                style={{ width: "100%", padding: "12px", background: "#fff", color: "#4F46E5", border: "1px solid #E5E7EB", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                ✏️ 수정하기
              </button>
            </div>
          )}
          {editNotify && [
            {
              key: "urgentNotice",
              label: "긴급공지",
              desc: "긴급 공지사항 알림",
              locked: true,
            },
            {
              key: "agreement",
              label: "단협규정",
              desc: "단협 변경 알림",
              locked: true,
            },
            { key: "board", label: "자유게시판", desc: "새 글 및 댓글 알림" },
            { key: "vote", label: "설문·투표", desc: "새 투표·설문 알림" },
            { key: "inquiry", label: "1:1문의", desc: "답변 알림" },
          ].map((item, i, arr) => (
            <div
              key={item.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 0",
                borderBottom: i < arr.length - 1 ? "1px solid #F3F4F6" : "none",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#1F2937",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {item.label}
                  {item.locked && (
                    <span style={{ fontSize: 10, color: "#9CA3AF" }}>
                      🔒 필수
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                  {item.desc}
                </div>
              </div>
              <button
                onClick={() => {
                  if (item.locked) return;
                  setNotifSettings((prev) => ({
                    ...prev,
                    [item.key]: !prev[item.key],
                  }));
                }}
                style={{
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  border: "none",
                  cursor: item.locked ? "not-allowed" : "pointer",
                  background: notifSettings[item.key] ? "#4F46E5" : "#E5E7EB",
                  position: "relative",
                  transition: "background 0.2s",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "#fff",
                    position: "absolute",
                    top: 3,
                    left: notifSettings[item.key] ? 23 : 3,
                    transition: "left 0.2s",
                  }}
                />
              </button>
            </div>
          ))}
          {editNotify && (
            <button
              onClick={() => setEditNotify(false)}
              style={{ width: "100%", marginTop: 14, padding: "12px", background: "linear-gradient(135deg, #4F46E5, #6D28D9)", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              완료
            </button>
          )}
        </div>

        {/* 앱 정보 */}
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "20px",
            marginBottom: 12,
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              color: "#1F2937",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 4,
                height: 18,
                background: "#4F46E5",
                borderRadius: 2,
              }}
            />
            앱 정보
          </div>
          {[
            { label: "앱 버전", value: "v1.0.0" },
            { label: "문의", value: "대공원승무지회" },
          ].map((item, i, arr) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "11px 0",
                borderBottom: i < arr.length - 1 ? "1px solid #F3F4F6" : "none",
              }}
            >
              <span style={{ fontSize: 13, color: "#6B7280" }}>
                {item.label}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1F2937" }}>
                {item.value}
              </span>
            </div>
          ))}
          <div style={{ padding: "11px 0", borderTop: "1px solid #F3F4F6" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <span style={{ fontSize: 13, color: "#6B7280" }}>제작</span>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{ fontSize: 13, fontWeight: 700, color: "#1e3a8a" }}
                >
                  모U다 플랫폼
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#daa520",
                    fontWeight: 600,
                    marginTop: 2,
                  }}
                >
                  모두 담다 · 모두 연결하다
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 로그아웃 / 탈퇴 */}
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            overflow: "hidden",
            marginBottom: 12,
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
          }}
        >
          <button
            onClick={() => setShowLogoutModal(true)}
            style={{
              width: "100%",
              padding: "16px 20px",
              background: "none",
              border: "none",
              borderBottom: "1px solid #F3F4F6",
              display: "flex",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "#EEF0FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                path="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                color="#4F46E5"
                size={18}
              />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>
              로그아웃
            </span>
            <span style={{ marginLeft: "auto", display: "flex" }}>
              <Icon path="M9 5l7 7-7 7" color="#D1D5DB" size={16} />
            </span>
          </button>
          <button
            onClick={() => setShowWithdrawModal(true)}
            style={{
              width: "100%",
              padding: "16px 20px",
              background: "none",
              border: "none",
              display: "flex",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "#FEE2E2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                color="#EF4444"
                size={18}
              />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#EF4444" }}>
              앱 탈퇴
            </span>
            <span style={{ marginLeft: "auto", display: "flex" }}>
              <Icon path="M9 5l7 7-7 7" color="#FCA5A5" size={16} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SalaryScreen({ onBack, user }: { onBack: () => void; user: any }) {
  const [selectedGrade, setSelectedGrade] = React.useState<number | null>(
    user?.grade ?? null
  );
  const [selectedHobong, setSelectedHobong] = React.useState<number | null>(
    user?.pay_step ?? null
  );
  const [salaryTable, setSalaryTable] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [workType, setWorkType] = React.useState<string>("");
  const [nightSettings, setNightSettings] = React.useState<any[]>([]);
  const [saveMsg, setSaveMsg] = React.useState<string>("");

  const [manualInputs, setManualInputs] = React.useState<
    Record<string, number>
  >({
    급식보조비: 0,
    가족수당: 0,
    열차승무수당: 0,
    자격면허수당: 0,
    기술수당: 0,
    대우수당: 0,
    직책수행비: 0,
    자체평가급: 0,
  });

  const [checkedItems, setCheckedItems] = React.useState<
    Record<string, boolean>
  >({
    업무보전수당: false,
    장기근속수당: false,
    직급보조비: false,
    급식보조비: false,
    가족수당: false,
    열차승무수당: false,
    자격면허수당: false,
    기술수당: false,
    대우수당: false,
    직책수행비: false,
    자체평가급: false,
  });

  const [nightHour, setNightHour] = React.useState<number>(0);
  const [nightMin, setNightMin] = React.useState<number>(0);
  const [nightCount, setNightCount] = React.useState<number>(0);
  const [worktypeSettings, setWorktypeSettings] = React.useState<any[]>([]);
  const [shiftBase, setShiftBase] = React.useState<any>(null);
  const [lastMonthLeaves, setLastMonthLeaves] = React.useState<any[]>([]);
  const [hfDay, setHfDay] = React.useState<number>(0);
  const [hfNight, setHfNight] = React.useState<number>(0);
  const [hfCount, setHfCount] = React.useState<number>(0);
  const [diaTable, setDiaTable] = React.useState<any[]>([]);
  const [holidays, setHolidays] = React.useState<string[]>([]);
  const [hfRecords, setHfRecords] = React.useState<any[]>([]);
    const [rotationData, setRotationData] = React.useState<any[]>([]);
  const [memberInfo, setMemberInfo] = React.useState<any>(null);
  const [dedRates, setDedRates] = React.useState<any>(null);
  const [overtimeHour, setOvertimeHour] = React.useState<number>(0);
  const [overtimeMin, setOvertimeMin] = React.useState<number>(0);
  const [showDeductInfo, setShowDeductInfo] = React.useState(false);

  // 기본급표 + 저장된 설정 불러오기
  React.useEffect(() => {
    const init = async () => {
      setLoading(true);
      const emp = user?.employee_number;
      const now = new Date();
      const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastPrev = new Date(firstThis.getTime() - 86400000);
      const py = lastPrev.getFullYear();
      const pm = lastPrev.getMonth();
      const mm = String(pm + 1).padStart(2, "0");
      const endDay = new Date(py, pm + 1, 0).getDate();
      const ty = now.getFullYear();
      const tm = String(now.getMonth() + 1).padStart(2, "0");
      const tEnd = new Date(ty, now.getMonth() + 1, 0).getDate();

      const [
        salaryRes,
        wtRes,
        baseRes,
        nightRes,
        diaRes,
        meRes,
        leaveRes,
        hfRes,
        settingsRes,
       rotRes,
        dedRes,
      ] = await Promise.all([
        supabase.from("salary_table").select("*").order("hobong", { ascending: true }),
        supabase.from("worktype_pay_settings").select("*"),
        supabase.from("shift_base").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("night_pay_settings").select("*"),
        supabase.from("kyobun_dia").select("dia_no, day_type, work_hours, night_hours"),
        emp ? supabase.from("members").select("grade, pay_step, start_position, schedule_total, work_group, work_type").eq("employee_number", emp).maybeSingle() : Promise.resolve({ data: null }),
        emp ? supabase.from("leave_history").select("*").eq("employee_number", emp).neq("status", "취소").gte("used_date", `${py}-${mm}-01`).lte("used_date", `${py}-${mm}-${String(endDay).padStart(2, "0")}`) : Promise.resolve({ data: null }),
        emp ? supabase.from("work_adjust").select("*").eq("employee_number", emp).eq("adjust_type", "holiday_fill").gte("work_date", `${ty}-${tm}-01`).lte("work_date", `${ty}-${tm}-${String(tEnd).padStart(2, "0")}`) : Promise.resolve({ data: null }),
        emp ? supabase.from("salary_settings").select("*").eq("employee_number", emp).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("schedule_rotation").select("*").in("group_name", ["대공원 114", "도봉 41"]),
        supabase.from("deduction_rates").select("*").order("year", { ascending: false }).limit(1).maybeSingle(),
   ]);

      if (salaryRes.data) setSalaryTable(salaryRes.data);
      if (wtRes.data) setWorktypeSettings(wtRes.data);
      if (baseRes.data) setShiftBase(baseRes.data);
      if (nightRes.data) setNightSettings(nightRes.data);
      if (diaRes.data) setDiaTable(diaRes.data);
            if (meRes.data) {
        setMemberInfo(meRes.data);
        if (meRes.data.grade) setSelectedGrade(Number(meRes.data.grade));
        if (meRes.data.pay_step) setSelectedHobong(Number(meRes.data.pay_step));
      }
      if (leaveRes.data) setLastMonthLeaves(leaveRes.data);
      if (hfRes.data) setHfRecords(hfRes.data);
          if (rotRes.data) setRotationData(rotRes.data);
      if (dedRes.data) setDedRates(dedRes.data);

            fetch("/.netlify/functions/read-holidays?year=" + ty)
        .then((r) => r.json())
        .then((hj) => { if (hj.holidays) setHolidays(hj.holidays); })
        .catch(() => {});
      if (settingsRes.data) {
        const s = settingsRes.data;
        if (s.work_type) setWorkType(s.work_type);
        if (s.checked_items) setCheckedItems(s.checked_items);
        if (s.manual_inputs) setManualInputs(s.manual_inputs);
      }

      setLoading(false);
    };
    init();
  }, []);

  // 설정 저장
  const handleSave = async () => {
    if (!user?.employee_number) return;
    const { error } = await supabase.from("salary_settings").upsert(
      {
        employee_number: user.employee_number,
        grade: selectedGrade,
        hobong: selectedHobong,
        work_type: workType,
        checked_items: checkedItems,
        manual_inputs: manualInputs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_number" }
    );

    if (!error) {
      setSaveMsg("✅ 저장됐어요!");
      setTimeout(() => setSaveMsg(""), 2500);
    } else {
      setSaveMsg("❌ 저장 실패. 다시 시도해 주세요.");
      setTimeout(() => setSaveMsg(""), 2500);
    }
  };

  const calcShift = (crew: string, date: Date): string => {
    if (!shiftBase) return "";
    const cycle = ["주간", "야간", "비번", "휴무"];
    const baseDate = new Date(shiftBase.base_date);
    baseDate.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - baseDate.getTime()) / 86400000);
    const bases: Record<string, number> = {
      A: cycle.indexOf(shiftBase.a_work_type),
      B: cycle.indexOf(shiftBase.b_work_type),
      C: cycle.indexOf(shiftBase.c_work_type),
      D: cycle.indexOf(shiftBase.d_work_type),
    };
    if (bases[crew] === undefined) return "";
    return cycle[(((bases[crew] + diff) % 4) + 4) % 4];
  };

  const getLastMonthNight = () => {
    if (!shiftBase || !user?.work_group) return null;
    if (!["A", "B", "C", "D"].includes(user.work_group)) return null;
    const now = new Date();
    const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastPrev = new Date(firstThis.getTime() - 86400000);
    const py = lastPrev.getFullYear();
    const pm = lastPrev.getMonth();
    const days = new Date(py, pm + 1, 0).getDate();
    let count = 0;
    for (let d = 1; d <= days; d++) {
      if (calcShift(user.work_group, new Date(py, pm, d)) === "야간") count++;
    }
    return { count, month: pm + 1 };
  };

  const lastMonthNight = getLastMonthNight();

  const finalNight = (() => {
    if (!lastMonthNight) return null;
    let c = lastMonthNight.count;
        for (const lv of lastMonthLeaves) {
      if (lv.status === "취소") continue;
      if (calcShift(user.work_group, new Date(lv.used_date)) === "야간") {
        c -= Number(lv.days) || 0;
      }
    }
    return Math.max(0, c);
  })();

  React.useEffect(() => {
    if (finalNight !== null) setNightCount(finalNight);
  }, [finalNight]);

  const getBasicSalary = () => {
    if (!selectedGrade || !selectedHobong) return null;
    const row = salaryTable.find((r) => r.hobong === selectedHobong);
    if (!row) return null;
    return row[`grade_${selectedGrade}`] ?? null;
  };

  const basicSalary = getBasicSalary();

  const getLongServicePay = () => {
    if (!selectedHobong) return 0;
    if (selectedHobong >= 25) return 130000;
    if (selectedHobong >= 20) return 110000;
    if (selectedHobong >= 15) return 80000;
    if (selectedHobong >= 10) return 60000;
    if (selectedHobong >= 5) return 50000;
    return 0;
  };

  const getGradeSupport = () => {
    if (!selectedGrade) return 0;
    if (selectedGrade === 6 || selectedGrade === 7) return 30000;
    return 0;
  };

  const getWorkTypePay = () => {
    if (!basicSalary || !workType) return 0;
    const rates: Record<string, number> = {
      통상: 0.1,
      변형통상: 0.108,
      변형근무: 0.087,
      "4조2교대(비심야)": 0.0675,
      "4조2교대(심야)": 0.0635,
      "4조2교대(야간집중)": 0.06,
      교번: 0.087,
    };
    return Math.round(basicSalary * (rates[workType] ?? 0));
  };

  const getAllowanceAmount = (item: string): number => {
    if (!checkedItems[item]) return 0;
    switch (item) {
      case "업무보전수당":
        return getWorkTypePay();
      case "장기근속수당":
        return getLongServicePay();
      case "직급보조비":
        return getGradeSupport();
      default:
        return manualInputs[item] ?? 0;
    }
  };

  const totalAllowance = Object.keys(checkedItems).reduce(
    (sum, item) => sum + getAllowanceAmount(item),
    0
  );

  const tongsangWage = (basicSalary ?? 0) + totalAllowance;
  const hourlyWage = tongsangWage > 0 ? tongsangWage / 209 : 0;

  const nightHoursPerShift =
    worktypeSettings.find((w) => w.work_type === workType)?.night_hours || 0;
    const isKyobun =
    memberInfo?.work_type === "교번" &&
    (memberInfo?.work_group === "대공원" || memberInfo?.work_group === "도봉");
  const kyobunNightHours = (() => {
    if (!isKyobun || rotationData.length === 0 || diaTable.length === 0) return 0;
    const n = new Date();
    const ft = new Date(n.getFullYear(), n.getMonth(), 1);
    const lp = new Date(ft.getTime() - 86400000);
    const yy = lp.getFullYear();
    const mn = lp.getMonth();
    const dd = new Date(yy, mn + 1, 0).getDate();
    let sum = 0;
    for (let i = 1; i <= dd; i++) {
      const w = calcKyobunWork(memberInfo, new Date(yy, mn, i), rotationData);
      if (w && Number(w.dia) >= 60) {
        const ds = `${yy}-${String(mn + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
        const { nightHours } = calcHolidayFillHours(w.dia, "야간", ds, diaTable, holidays);
        sum += nightHours;
      }
    }
    return sum;
  })();
  const nightTotalHours = isKyobun ? kyobunNightHours : nightHoursPerShift * nightCount;
  const nightPay = Math.round(hourlyWage * 0.5 * nightTotalHours);
  const overtimeTotalHours = overtimeHour + overtimeMin / 60;
  const overtimeBase8 = Math.min(overtimeTotalHours, 8);
  const overtimeOver8 = Math.max(overtimeTotalHours - 8, 0);
  const overtimePay = Math.round(
    hourlyWage * 1.5 * overtimeBase8 + hourlyWage * 2.0 * overtimeOver8
  );

  let hfTotalWork = 0;
  let hfTotalNight = 0;
  let hfAutoCount = 0;
  let hfPaySum = 0;
  hfRecords.forEach((rec: any) => {
    const m = (rec.memo || "").match(/다이아\s*(\d+)/);
    if (!m) return;
    const { workHours, nightHours } = calcHolidayFillHours(
      m[1],
      rec.work_shift,
      rec.work_date,
      diaTable,
      holidays
    );
    if (workHours <= 0) return;
    const within8 = Math.min(workHours, 8);
    const over8 = Math.max(workHours - 8, 0);
    hfPaySum +=
      hourlyWage * (within8 * 1.5 + over8 * 2.0) + hourlyWage * 0.5 * nightHours;
    hfTotalWork += workHours;
    hfTotalNight += nightHours;
    hfAutoCount += 1;
  });
  const holidayFillPay = Math.round(hfPaySum);

  const totalGross = tongsangWage + nightPay + overtimePay + holidayFillPay;

  const r = dedRates || {};
  const nationalPension = Math.round(tongsangWage * (r.national_pension ?? 0.045));
  const healthInsurance = Math.round(tongsangWage * (r.health_insurance ?? 0.03545));
  const longTermCare = Math.round(healthInsurance * (r.long_term_care ?? 0.1295));
  const employmentInsurance = Math.round(tongsangWage * (r.employment_insurance ?? 0.009));
  const incomeTax = Math.round(totalGross * (r.income_tax ?? 0.02));
  const localTax = Math.round(incomeTax * (r.local_tax ?? 0.1));
  const unionFee = Math.round((basicSalary ?? 0) * (r.union_fee ?? 0.012));

  const totalDeduction =
    nationalPension +
    healthInsurance +
    longTermCare +
    employmentInsurance +
    incomeTax +
    localTax +
    unionFee;
  const netPay = totalGross - totalDeduction;

  const formatWon = (n: number) => n.toLocaleString("ko-KR") + "원";

  const grades = [1, 2, 3, 4, 5, 6, 7];
  const hobongs = Array.from({ length: 40 }, (_, i) => i + 1);
  const workTypes = [
    "통상",
    "변형통상",
    "변형근무",
    "4조2교대(비심야)",
    "4조2교대(심야)",
    "4조2교대(야간집중)",
    "교번",
  ];

  const allowanceItems = [
    {
      id: "업무보전수당",
      label: "업무보전수당",
      type: "auto",
      desc: "근무형태 선택 후 자동계산",
     extra: (
        <>
          <select
            value={workType}
            onChange={(e) => setWorkType(e.target.value)}
            style={{
              marginTop: 6,
              width: "100%",
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid #DDD6FE",
              fontSize: 13,
              color: "#4338CA",
              background: "#F5F3FF",
            }}
          >
            <option value="">근무형태 선택</option>
            {workTypes.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          {workType && (() => {
            const found = nightSettings.find((s) => s.work_type === workType);
            return found ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "#4338CA", fontWeight: 700 }}>
                🌙 야간 1회 = {found.night_hours}시간 (관리자 설정)
              </div>
            ) : null;
          })()}
        </>
      ),
    },
    {
      id: "장기근속수당",
      label: "장기근속수당",
      type: "auto",
      desc: selectedHobong
        ? getLongServicePay() > 0
          ? `${selectedHobong}호봉 → 자동계산`
          : "5호봉 미만 해당없음"
        : "호봉 선택 후 자동계산",
    },
    {
      id: "직급보조비",
      label: "직급보조비",
      type: "auto",
      desc: selectedGrade
        ? getGradeSupport() > 0
          ? `${selectedGrade}급 → 자동계산`
          : "6~7급만 해당"
        : "직급 선택 후 자동계산",
    },
    {
      id: "급식보조비",
      label: "급식보조비",
      type: "manual",
      desc: "명세서 확인 후 직접 입력",
    },
    {
      id: "가족수당",
      label: "가족수당",
      type: "manual",
      desc: "명세서 확인 후 직접 입력",
    },
    {
      id: "열차승무수당",
      label: "열차승무수당",
      type: "manual",
      desc: "기관사10만/운용8만/차장6만",
    },
    {
      id: "자격면허수당",
      label: "자격면허수당",
      type: "manual",
      desc: "1종3만/2종2만/3종1.5만/4종8만",
    },
    {
      id: "기술수당",
      label: "기술수당",
      type: "manual",
      desc: "기술사8만/기사5만/산업기사4만/기능사2만",
    },
    {
      id: "대우수당",
      label: "대우수당",
      type: "manual",
      desc: "4급3.7만/5급3만",
    },
    {
      id: "직책수행비",
      label: "직책수행비",
      type: "manual",
      desc: "역장/팀장 등 직책자만",
    },
    {
      id: "자체평가급",
      label: "자체평가급(75%)",
      type: "manual",
      desc: "매년 변동 - 명세서 확인",
    },
  ];

  const TimeInput = ({
    hour,
    min,
    onHourChange,
    onMinChange,
    pay,
    color,
  }: {
    hour: number;
    min: number;
    onHourChange: (v: number) => void;
    onMinChange: (v: number) => void;
    pay: number;
    color: string;
  }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        value={hour || ""}
        onChange={(e) => onHourChange(parseInt(e.target.value) || 0)}
        placeholder="0"
        style={{
          width: 48,
          padding: "7px 6px",
          borderRadius: 8,
          border: "1px solid #E5E7EB",
          fontSize: 14,
          textAlign: "center",
        }}
      />
      <span style={{ fontSize: 13, color: "#6B7280" }}>시간</span>
      <input
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        value={min || ""}
        onChange={(e) =>
          onMinChange(Math.min(59, parseInt(e.target.value) || 0))
        }
        placeholder="0"
        style={{
          width: 42,
          padding: "7px 6px",
          borderRadius: 8,
          border: "1px solid #E5E7EB",
          fontSize: 14,
          textAlign: "center",
        }}
      />
      <span style={{ fontSize: 13, color: "#6B7280" }}>분</span>
      {(hour > 0 || min > 0) && (
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color,
            minWidth: 72,
            textAlign: "right",
          }}
        >
          {formatWon(pay)}
        </span>
      )}
    </div>
  );

  const DeductInfoModal = () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={() => setShowDeductInfo(false)}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "24px 24px 0 0",
          padding: "24px 20px 40px",
          width: "100%",
          maxWidth: 430,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "#1F2937",
            marginBottom: 4,
          }}
        >
          📋 공제율 안내 ({(dedRates?.year ?? 2025) + "년 기준"})
        </div>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 20 }}>
          법정 고정 요율 적용 · 실제 명세서와 소폭 차이 있을 수 있음
        </div>
 {[
                  { label: "국민연금", rate: `${((dedRates?.national_pension ?? 0.045) * 100).toFixed(3).replace(/\.?0+$/, "")}%`, base: "통상임금 기준", color: "#3B82F6" },
                  { label: "건강보험", rate: `${((dedRates?.health_insurance ?? 0.03545) * 100).toFixed(3).replace(/\.?0+$/, "")}%`, base: "통상임금 기준", color: "#10B981" },
                  { label: "장기요양보험", rate: `건강보험료 × ${((dedRates?.long_term_care ?? 0.1295) * 100).toFixed(2).replace(/\.?0+$/, "")}%`, base: "건강보험료 기준", color: "#8B5CF6" },
                  { label: "고용보험", rate: `${((dedRates?.employment_insurance ?? 0.009) * 100).toFixed(3).replace(/\.?0+$/, "")}%`, base: "통상임금 기준", color: "#F59E0B" },
                  { label: "소득세", rate: "약 2%", base: "부양가족 1인 기준 추정", color: "#EF4444" },
                  { label: "지방소득세", rate: `소득세 × ${((dedRates?.local_tax ?? 0.1) * 100).toFixed(1).replace(/\.?0+$/, "")}%`, base: "소득세 기준", color: "#EC4899" },
                  { label: "조합비", rate: `기본급 × ${((dedRates?.union_fee ?? 0.012) * 100).toFixed(2).replace(/\.?0+$/, "")}%`, base: "기본급 기준", color: "#6366F1" },
                ].map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 0",
              borderBottom: "1px solid #F3F4F6",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>
                {item.label}
              </div>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
                {item.base}
              </div>
            </div>
            <span
              style={{
                background: item.color + "18",
                color: item.color,
                fontWeight: 700,
                fontSize: 14,
                padding: "4px 12px",
                borderRadius: 20,
              }}
            >
              {item.rate}
            </span>
          </div>
        ))}
        <div
          style={{
            marginTop: 14,
            background: "#FEF3C7",
            borderRadius: 10,
            padding: "10px 14px",
          }}
        >
          <div style={{ fontSize: 12, color: "#92400E", lineHeight: 1.7 }}>
            ⚠️ 소득세는 부양가족 수, 비과세 항목에 따라 실제와 다를 수 있습니다.
            <br />
            연장근로수당은 8시간 이하 1.5배, 8시간 초과분은 2배 적용됩니다.
          </div>
        </div>
        <button
          onClick={() => setShowDeductInfo(false)}
          style={{
            marginTop: 20,
            width: "100%",
            padding: "14px 0",
            background: "#4F46E5",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontSize: 15,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          확인
        </button>
      </div>
    </div>
  );

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      {showDeductInfo && <DeductInfoModal />}

      {/* 헤더 */}
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onBack}
              style={{
              background: "rgba(255,255,255,0.15)",
                border: "none",
                borderRadius: "50%",
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
            </button>
            <div>
              <div style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>
                급여·수당 계산
              </div>
              <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>
                기본급 + 수당 + 공제 → 실수령액
              </div>
            </div>
          </div>
          {/* 저장 버튼 */}
          <button
            onClick={handleSave}
            style={{
              background: "rgba(255,255,255,0.25)",
              border: "1.5px solid rgba(255,255,255,0.5)",
              borderRadius: 20,
              padding: "6px 16px",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            💾 저장
          </button>
        </div>
        {/* 저장 메시지 */}
        {saveMsg !== "" && (
          <div
            style={{
              marginTop: 8,
              textAlign: "center",
              fontSize: 13,
              color: "#fff",
              background: "rgba(255,255,255,0.2)",
              borderRadius: 8,
              padding: "4px 0",
            }}
          >
            {saveMsg}
          </div>
        )}
      </div>

      <div style={{ padding: "20px 16px" }}>
        {loading && (
          <div
            style={{
              textAlign: "center",
              padding: "40px 0",
              color: "#6366F1",
              fontSize: 14,
            }}
          >
            설정 불러오는 중...
          </div>
        )}

        {!loading && (
          <>
            {/* 직급·호봉 (보기 전용) */}
            <div
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: "18px 16px",
                marginBottom: 14,
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1F2937", marginBottom: 14 }}>
                1️⃣ 직급 · 호봉
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "#6B7280" }}>직급</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#4F46E5" }}>
                  {selectedGrade ? `${selectedGrade}급` : "-"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, marginTop: 12, borderTop: "1px solid #F3F4F6" }}>
                <span style={{ fontSize: 14, color: "#6B7280" }}>현재 호봉</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#7C3AED" }}>
                  {selectedHobong ? `${selectedHobong}호봉` : "-"}
                </span>
              </div>
              <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "12px 14px", marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 14, color: "#6B7280" }}>내 시급</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: "#1F2937" }}>
                    {Math.round(hourlyWage).toLocaleString("ko-KR")}
                    <span style={{ fontSize: 12, fontWeight: 400, color: "#9CA3AF" }}>원</span>
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4, textAlign: "right" }}>
                  통상임금 ÷ 209시간
                </div>
              </div>
              <div style={{ background: "#EEF2FF", borderRadius: 8, padding: "8px 11px", marginTop: 12, fontSize: 12, color: "#4338CA" }}>
                직급·호봉은 마이페이지에서 변경하세요
              </div>
            </div>
            {/* 수당 항목 */}
            <div
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: "18px 16px",
                marginBottom: 14,
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#1F2937",
                  marginBottom: 4,
                }}
              >
                3️⃣ 수당 항목 선택
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 14 }}>
                해당되는 항목에 체크하세요
              </div>
              {allowanceItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    borderRadius: 12,
                    border: checkedItems[item.id]
                      ? "1.5px solid #A5B4FC"
                      : "1.5px solid #F3F4F6",
                    background: checkedItems[item.id] ? "#F5F3FF" : "#FAFAFA",
                    padding: "12px 14px",
                    marginBottom: 10,
                    transition: "all 0.15s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checkedItems[item.id]}
                          onChange={(e) =>
                            setCheckedItems((prev) => ({
                              ...prev,
                              [item.id]: e.target.checked,
                            }))
                          }
                          style={{
                            width: 18,
                            height: 18,
                            accentColor: "#4F46E5",
                            cursor: "pointer",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: "#1F2937",
                          }}
                        >
                          {item.label}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 7px",
                            borderRadius: 20,
                            background:
                              item.type === "auto" ? "#DBEAFE" : "#FEF3C7",
                            color: item.type === "auto" ? "#1D4ED8" : "#92400E",
                          }}
                        >
                          {item.type === "auto" ? "자동" : "직접입력"}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#9CA3AF",
                          marginTop: 3,
                          paddingLeft: 26,
                        }}
                      >
                        {item.desc}
                      </div>
                      {checkedItems[item.id] && item.extra && (
                        <div style={{ paddingLeft: 26 }}>{item.extra}</div>
                      )}
                      {checkedItems[item.id] && item.type === "manual" && (
                        <div style={{ paddingLeft: 26, marginTop: 8 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <input
                              type="tel"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={manualInputs[item.id] || ""}
                              onChange={(e) =>
                                setManualInputs((prev) => ({
                                  ...prev,
                                  [item.id]: parseInt(e.target.value) || 0,
                                }))
                              }
                              placeholder="금액 입력"
                              style={{
                                flex: 1,
                                padding: "7px 10px",
                                borderRadius: 8,
                                border: "1px solid #DDD6FE",
                                fontSize: 14,
                              }}
                            />
                            <span style={{ fontSize: 13, color: "#6B7280" }}>
                              원
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right", minWidth: 80 }}>
                      {checkedItems[item.id] && item.type !== "manual" && (
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: "#4F46E5",
                          }}
                        >
                          {formatWon(getAllowanceAmount(item.id))}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 야간·연장 근로시간 */}
            <div
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: "18px 16px",
                marginBottom: 14,
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#1F2937",
                  marginBottom: 4,
                }}
              >
                4️⃣ 야간·연장 근로시간
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>
                이번 달 실제 시간 입력 (없으면 0)
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}
                  >
                    야간근로수당
                  </div>
                  <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                    22:00~06:00 · 가산율 0.5배
                  </div>
                </div>
                                {isKyobun ? (
                  <div style={{ background: "#F5F3FF", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 12, color: "#6D28D9", marginBottom: 4 }}>
                      📅 전달 야간 다이아 근무 (다이아별 실제 시간 합산)
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#7C3AED" }}>
                      = 이번 달 야간 {Math.round(nightTotalHours)}시간 (자동)
                    </div>
                  </div>
                ) : (
                  <>
                    {nightHoursPerShift > 0 ? (
                      <div style={{ fontSize: 12, color: "#7C3AED", marginBottom: 8 }}>
                        🌙 야간 1회 = {nightHoursPerShift}시간 (관리자 설정)
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8 }}>
                        근무형태를 먼저 선택하세요
                      </div>
                    )}
                    {lastMonthNight ? (
                      <div style={{ background: "#F5F3FF", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 12, color: "#6D28D9", marginBottom: 4 }}>
                          📅 전달({lastMonthNight.month}월) 근무표 야간 {lastMonthNight.count}일
                        </div>
                        {lastMonthNight.count - (finalNight ?? 0) > 0 && (
                          <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 4 }}>
                            − 야간에 쓴 휴가 {lastMonthNight.count - (finalNight ?? 0)}일 차감
                          </div>
                        )}
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#7C3AED" }}>
                          = 이번 달 야간 {finalNight}회 (자동)
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                        교대 조원만 야간이 자동계산돼요
                      </div>
                    )}
                  </>
                )}
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#7C3AED",
                    textAlign: "right",
                  }}
                >
                총 {Math.round(nightTotalHours)}시간 · {nightPay.toLocaleString("ko-KR")}원
                </div>
              </div>
              
              <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 16, marginTop: 16 }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>
                    대무충당수당
                  </div>
                  <div style={{ fontSize: 12, color: "#9CA3AF" }}>
                    근무조정에 기록한 대무충당으로 자동 계산
                  </div>
                </div>
                {hfAutoCount > 0 ? (
                  <>
                    <div style={{ background: "#FEF2F2", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#6B7280", lineHeight: 1.7 }}>
                      이번 달 대무충당 {hfAutoCount}회 · 인정 {hfTotalWork.toFixed(2)}시간 (야간 {hfTotalNight.toFixed(2)}시간 포함)
                    </div>
                    <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700, color: "#DC2626", textAlign: "right" }}>
                      {holidayFillPay.toLocaleString("ko-KR")}원
                    </div>
                  </>
                ) : (
                  <div style={{ background: "#F9FAFB", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#9CA3AF" }}>
                    이번 달 대무충당 기록이 없어요.
                  </div>
                )}
              </div>
            </div>

            {/* 명세서 */}
            {basicSalary ? (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  overflow: "hidden",
                  marginBottom: 16,
                  boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
                }}
              >
                <div
                  style={{
                    background:
                      "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)",
                    padding: "16px 20px",
                  }}
                >
                  <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
                    예상 급여 명세서
                  </div>
                  <div
                    style={{
                      color: "#fff",
                      fontSize: 22,
                      fontWeight: 800,
                      marginTop: 4,
                    }}
                  >
                    {selectedGrade}급 {selectedHobong}호봉
                  </div>
                </div>
                <div style={{ padding: "16px 20px" }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#6366F1",
                      marginBottom: 10,
                    }}
                  >
                    💰 지급
                  </div>
                  {[
                    {
                      label: `기본급 (${selectedGrade}급 ${selectedHobong}호봉)`,
                      amount: basicSalary,
                    },
                    ...Object.keys(checkedItems)
                      .filter(
                        (k) => checkedItems[k] && getAllowanceAmount(k) > 0
                      )
                      .map((k) => ({
                        label: k,
                        amount: getAllowanceAmount(k),
                      })),
                    ...(nightPay > 0
                      ? [
                          {
                           label: `야간근로수당 (${nightCount}회)`,
                            amount: nightPay,
                          },
                        ]
                      : []),
                    ...(overtimePay > 0
                      ? [
                          {
                            label: `연장근로수당 (${overtimeHour}시간 ${overtimeMin}분)`,
                            amount: overtimePay,
                          },
                        ]
                      : []),
                    ...(holidayFillPay > 0
                      ? [
                          {
                            label: `휴무충당 (${hfCount}회)`,
                            amount: holidayFillPay,
                          },
                        ]
                      : []),
                  ].map((row, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "7px 0",
                        borderBottom: "1px solid #F9FAFB",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "#374151" }}>
                        {row.label}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#1F2937",
                        }}
                      >
                        {formatWon(row.amount)}
                      </span>
                    </div>
                  ))}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "10px",
                      margin: "8px 0 4px",
                      background: "#EEF2FF",
                      borderRadius: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#4338CA",
                      }}
                    >
                      통상임금 합계
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: "#4338CA",
                      }}
                    >
                      {formatWon(tongsangWage)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "10px",
                      marginBottom: 4,
                      background: "#F5F3FF",
                      borderRadius: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "#4F46E5",
                      }}
                    >
                      세전 합계
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: "#4F46E5",
                      }}
                    >
                      {formatWon(totalGross)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 20,
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#EF4444",
                      }}
                    >
                      📤 공제
                    </div>
                    <button
                      onClick={() => setShowDeductInfo(true)}
                      style={{
                        background: "#FEF2F2",
                        border: "none",
                        borderRadius: 20,
                        padding: "4px 12px",
                        fontSize: 12,
                        color: "#EF4444",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      공제율 안내 ℹ️
                    </button>
                  </div>
                  {[
                  { label: `국민연금 (${((r.national_pension ?? 0.045) * 100).toFixed(3).replace(/\.?0+$/, "")}%)`, amount: nationalPension },
                  { label: `건강보험 (${((r.health_insurance ?? 0.03545) * 100).toFixed(3).replace(/\.?0+$/, "")}%)`, amount: healthInsurance },
                  { label: `장기요양보험 (건보료×${((r.long_term_care ?? 0.1295) * 100).toFixed(2).replace(/\.?0+$/, "")}%)`, amount: longTermCare },
                  { label: `고용보험 (${((r.employment_insurance ?? 0.009) * 100).toFixed(3).replace(/\.?0+$/, "")}%)`, amount: employmentInsurance },
                  { label: "소득세 (약 2%, 부양1인 기준)", amount: incomeTax },
                  { label: `지방소득세 (소득세×${((r.local_tax ?? 0.1) * 100).toFixed(1).replace(/\.?0+$/, "")}%)`, amount: localTax },
                  { label: `조합비 (기본급×${((r.union_fee ?? 0.012) * 100).toFixed(2).replace(/\.?0+$/, "")}%)`, amount: unionFee },
                ].map((row, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "7px 0",
                        borderBottom: "1px solid #F9FAFB",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "#374151" }}>
                        {row.label}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#EF4444",
                        }}
                      >
                        - {formatWon(row.amount)}
                      </span>
                    </div>
                  ))}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "10px",
                      marginTop: 4,
                      background: "#FEF2F2",
                      borderRadius: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "#EF4444",
                      }}
                    >
                      공제 합계
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: "#EF4444",
                      }}
                    >
                      - {formatWon(totalDeduction)}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      background:
                        "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)",
                      borderRadius: 14,
                      padding: "16px 20px",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        color: "rgba(255,255,255,0.8)",
                        fontSize: 13,
                        marginBottom: 6,
                      }}
                    >
                      예상 실수령액
                    </div>
                    <div
                      style={{
                        color: "#fff",
                        fontSize: 30,
                        fontWeight: 800,
                        letterSpacing: -1,
                      }}
                    >
                      {formatWon(netPay)}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      background: "#FFFBEB",
                      borderRadius: 10,
                      padding: "10px 14px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "#92400E",
                        lineHeight: 1.7,
                      }}
                    >
                      ⚠️ 본 계산기는 <b>참고용</b>이며 실제 명세서와 차이가 있을
                      수 있습니다. 소득세는 부양가족 수에 따라 달라지며, 정확한
                      금액은 실제 급여명세서를 확인하세요.
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  padding: "30px 20px",
                  textAlign: "center",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}
              >
                <div style={{ color: "#9CA3AF", fontSize: 14 }}>
                  직급과 호봉을 선택하면
                  <br />
                  예상 명세서가 표시됩니다 💼
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
// ── 연차·기타휴가 ──
function LeaveScreen({ onBack, user }) {
  // 잔여일수 state (사용자가 입력한 값)
  const [remaining, setRemaining] = React.useState({
    annual: 0,
    tempAnnual: 0,
    promotedAnnual: 0,
    substitute: 0,
    study: 0,
    longService: 0,
  });

  // 편집 모드 (지금 어떤 휴가를 편집 중인지)
  const [editingId, setEditingId] = React.useState(null);
  const [editValue, setEditValue] = React.useState("");

  // 휴가 사용 모달 state
  const [useModal, setUseModal] = React.useState(null);
  const [useDate, setUseDate] = React.useState(
    new Date().toISOString().slice(0, 10)
  );
  const [useDays, setUseDays] = React.useState("1");
 const [useMemo, setUseMemo] = React.useState("");

  // 사용 내역 불러오기
  const [history, setHistory] = React.useState<any[]>([]);
  const loadHistory = async () => {
    if (!user?.employee_number) return;
    const { data } = await supabase
      .from("leave_history")
      .select("*")
      .eq("employee_number", user.employee_number)
      .order("used_date", { ascending: false });
    if (data) setHistory(data);
  };
  React.useEffect(() => {
    loadHistory();
  }, [user]);

  // 휴가 사용 취소 (잔여일수 복구)
  const cancelLeave = async (h: any) => {
    if (!window.confirm("이 휴가 사용을 취소할까요? 잔여일수가 복구됩니다.")) return;
    const { error } = await supabase
      .from("leave_history")
      .update({ status: "취소" })
      .eq("id", h.id);
    if (error) {
      alert("취소 실패: " + error.message);
      return;
    }
    const cur = (remaining as any)[h.leave_type] || 0;
    await saveRemaining(h.leave_type, cur + Number(h.days));
    loadHistory();
  };
  // 휴가 사용 처리
  const useLeave = async (item) => {
    const days = parseFloat(useDays);
    if (!days || days <= 0) {
      alert("사용 일수를 입력해주세요.");
      return;
    }
    if (days > item.days) {
      alert(`잔여일수(${item.days}일)보다 많이 사용할 수 없습니다.`);
      return;
    }
    if (!user?.employee_number) {
      alert("로그인 정보가 없습니다.");
      return;
    }
    // 1. 사용 이력 저장
    const { error: histError } = await supabase.from("leave_history").insert({
      employee_number: user.employee_number,
      leave_type: item.id,
      used_date: useDate,
      days: days,
      memo: useMemo || null,
    });
    if (histError) {
      alert("이력 저장 실패: " + histError.message);
      return;
    }
    // 2. 잔여일수 차감
    const newRemaining = item.days - days;
    await saveRemaining(item.id, newRemaining);
    // 3. 모달 닫기
    setUseModal(null);
    setUseDate(new Date().toISOString().slice(0, 10));
    setUseDays("1");
    setUseMemo("");
    alert(`${item.label} ${days}일 사용 처리되었습니다.`);
    loadHistory();
  };

  // 잔여일수 저장하기
  const saveRemaining = async (id, value) => {
    const num = parseFloat(value) || 0;
    if (num < 0) {
      alert("0 이상의 숫자를 입력해주세요.");
      return;
    }
    // 화면 먼저 업데이트
    setRemaining({ ...remaining, [id]: num });
    // DB 컬럼명 매핑
    const columnMap = {
      annual: "annual_remaining",
      tempAnnual: "tempAnnual_remaining",
      promotedAnnual: "promotedAnnual_remaining",
      substitute: "substitute_remaining",
      study: "study_remaining",
      longService: "longService_remaining",
    };
    // DB에 저장
    if (user?.employee_number) {
      const { error } = await supabase
        .from("members")
        .update({ [columnMap[id]]: num })
        .eq("employee_number", user.employee_number);
      if (error) {
        alert("저장 실패: " + error.message);
        return;
      }
    }
    setEditingId(null);
    setEditValue("");
  };

  // DB에서 잔여일수 불러오기
  React.useEffect(() => {
    if (!user?.employee_number) return;
    (async () => {
      const { data, error } = await supabase
        .from("members")
        .select(
          "annual_remaining, tempAnnual_remaining, promotedAnnual_remaining, substitute_remaining, study_remaining, longService_remaining"
        )
        .eq("employee_number", user.employee_number)
        .maybeSingle();
      if (error) {
        console.log("휴가 정보 가져오기 실패:", error);
        return;
      }
      if (data) {
        setRemaining({
          annual: Number(data.annual_remaining) || 0,
          tempAnnual: Number(data.tempAnnual_remaining) || 0,
          promotedAnnual: Number(data.promotedAnnual_remaining) || 0,
          substitute: Number(data.substitute_remaining) || 0,
          study: Number(data.study_remaining) || 0,
          longService: Number(data.longService_remaining) || 0,
        });
      }
    })();
  }, []);

  const leaveItems = [
    {
      id: "annual",
      label: "연차휴가",
      days: remaining.annual,
      color: "#4F46E5",
      bg: "#EEF0FF",
      icon: "🏖️",
    },
    {
      id: "tempAnnual",
      label: "가연차휴가",
      days: remaining.tempAnnual,
      color: "#10B981",
      bg: "#ECFDF5",
      icon: "📅",
    },
    {
      id: "promotedAnnual",
      label: "촉진연차",
      days: remaining.promotedAnnual,
      color: "#F59E0B",
      bg: "#FEF3C7",
      icon: "⚡",
    },
    {
      id: "substitute",
      label: "대체휴가",
      days: remaining.substitute,
      color: "#8B5CF6",
      bg: "#F3E8FF",
      icon: "🔄",
    },
    {
      id: "study",
      label: "학습휴가",
      days: remaining.study,
      color: "#EC4899",
      bg: "#FCE7F3",
      icon: "📚",
    },
    {
      id: "longService",
      label: "장기재직휴가",
      days: remaining.longService,
      color: "#06B6D4",
      bg: "#CFFAFE",
      icon: "🎖️",
    },
  ];

  return (
    <div
      style={{ minHeight: "100vh", background: "#F9FAFB", paddingBottom: 80 }}
    >
      {/* 헤더 */}
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "#fff",
        }}
      >
        <button
          onClick={onBack}
          style={{
           background: "rgba(255,255,255,0.15)",
            border: "none",
            borderRadius: "50%",
            width: 36,
            height: 36,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            }}
        >
        <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            연차·기타휴가
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.85 }}>
            내 휴가 현황
          </p>
        </div>
      </div>

      {/* 요약 박스 */}
      <div
        style={{
          margin: "16px",
          padding: "16px",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          display: "flex",
          justifyContent: "space-around",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
            총 잔여
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#4F46E5" }}>
            {leaveItems.reduce((s, x) => s + x.days, 0)}일
          </div>
        </div>
        <div style={{ width: 1, background: "#eee" }} />
        <div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
            휴가 종류
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111" }}>
            {leaveItems.length}개
          </div>
        </div>
      </div>

      {/* 카드 그리드 3×2 */}
      <div
        style={{
          padding: "0 16px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        {leaveItems.map((item) => (
          <div
            key={item.id}
            style={{
              background: "#fff",
              border:
                editingId === item.id ? `2px solid ${item.color}` : "none",
              borderRadius: 14,
              padding: "16px 14px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minHeight: 110,
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: item.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
              }}
            >
              {item.icon}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>
              {item.label}
            </div>
            {editingId === item.id ? (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  autoFocus
                  style={{
                    width: 60,
                    fontSize: 18,
                    fontWeight: 700,
                    color: item.color,
                    border: `1.5px solid ${item.color}`,
                    borderRadius: 6,
                    padding: "4px 6px",
                    outline: "none",
                  }}
                />
                <span style={{ fontSize: 12, color: "#888" }}>일</span>
                <button
                  onClick={() => saveRemaining(item.id, editValue)}
                  style={{
                    marginLeft: 4,
                    padding: "4px 8px",
                    fontSize: 11,
                    background: item.color,
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  저장
                </button>
              </div>
            ) : (
              <div
                onClick={() => {
                  setEditingId(item.id);
                  setEditValue(String(item.days));
                }}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 4,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{ fontSize: 22, fontWeight: 700, color: item.color }}
                >
                  {item.days}
                </span>
                <span style={{ fontSize: 12, color: "#888" }}>일</span>
                <span style={{ fontSize: 10, color: "#9CA3AF", marginLeft: 4 }}>
                  ✏️
                </span>
              </div>
            )}
            {editingId !== item.id && item.days > 0 && (
              <button
                onClick={() => setUseModal(item)}
                style={{
                  marginTop: 4,
                  padding: "6px 0",
                  fontSize: 11,
                  fontWeight: 600,
                  background: item.bg,
                  color: item.color,
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                휴가 사용
              </button>
            )}
          </div>
        ))}
      </div>
{/* 휴가 사용 내역 */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2937" }}>휴가 사용 내역</div>
          <div style={{ fontSize: 12, color: "#9CA3AF" }}>
            총 {history.filter((h) => h.status !== "취소").length}건
          </div>
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: "20px 0" }}>
            아직 사용한 휴가가 없어요
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((h) => {
              const cancelled = h.status === "취소";
              const typeLabel =
                leaveItems.find((i) => i.id === h.leave_type)?.label || h.leave_type;
              return (
                <div
                  key={h.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #F3F4F6",
                    borderRadius: 12,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: cancelled ? 0.55 : 1,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ background: cancelled ? "#F3F4F6" : "#EEF0FF", color: cancelled ? "#9CA3AF" : "#4F46E5", fontSize: 12, borderRadius: 6, padding: "2px 8px" }}>
                        {typeLabel}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: cancelled ? "#9CA3AF" : "#1F2937", textDecoration: cancelled ? "line-through" : "none" }}>
                        {h.days}일
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "#9CA3AF" }}>
                      {h.used_date}{h.memo ? ` · ${h.memo}` : ""}
                    </div>
                  </div>
                  {cancelled ? (
                    <span style={{ fontSize: 12, color: "#9CA3AF" }}>취소됨</span>
                  ) : (
                    <button
                      onClick={() => cancelLeave(h)}
                      style={{ fontSize: 13, color: "#EF4444", padding: "6px 12px", border: "1px solid #E5E7EB", borderRadius: 8, background: "#fff", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      취소
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* 휴가 사용 모달 */}
      {useModal && (
        <div
          onClick={() => setUseModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 20,
              width: "100%",
              maxWidth: 360,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              {useModal.icon} {useModal.label} 사용
            </div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
              잔여: {useModal.days}일
            </div>

            {/* 날짜 */}
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "#6B7280",
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                사용 날짜
              </div>
              <input
                type="date"
                value={useDate}
                onChange={(e) => setUseDate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 14,
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  background: "#fff",
                  WebkitAppearance: "none",
                  appearance: "none",
                }}
              />
            </div>

            {/* 일수 선택 버튼 */}
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "#6B7280",
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                사용 일수
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                {["0.25", "0.5", "1"].map((d) => (
                  <button
                    key={d}
                    onClick={() => setUseDays(d)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      fontSize: 13,
                      fontWeight: 600,
                      background: useDays === d ? useModal.color : "#F3F4F6",
                      color: useDays === d ? "#fff" : "#6B7280",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    {d === "0.25" ? "반반차" : d === "0.5" ? "반차" : "연차"}
                    <div
                      style={{ fontSize: 10, fontWeight: 400, marginTop: 2 }}
                    >
                      {d}일
                    </div>
                  </button>
                ))}
              </div>
              <input
                type="number"
                step="0.25"
                min="0"
                value={useDays}
                onChange={(e) => setUseDays(e.target.value)}
                placeholder="직접 입력 (예: 2)"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 13,
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {/* 메모 */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "#6B7280",
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                메모 (선택)
              </div>
              <input
                type="text"
                value={useMemo}
                onChange={(e) => setUseMemo(e.target.value)}
                placeholder="예: 병원 진료"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1.5px solid #E5E7EB",
                  fontSize: 14,
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {/* 버튼 */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setUseModal(null)}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: "#F3F4F6",
                  color: "#6B7280",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                취소
              </button>
              <button
                onClick={() => useLeave(useModal)}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: useModal.color,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                사용 처리
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 안내문 */}

      <div
        style={{
          margin: "20px 16px 0",
          padding: "12px 14px",
          background: "#FEF3C7",
          borderRadius: 10,
          fontSize: 12,
          color: "#92400E",
          lineHeight: 1.5,
        }}
      >
        💡 표시된 일수는 임시값입니다. 추후 실제 데이터와 연동됩니다.
      </div>
    </div>
  );
}
function WorkAdjustScreen({ onBack, user }) {
  const [activeTab, setActiveTab] = useState("대기충당");
  const [diaPhoto, setDiaPhoto] = useState(null);
  const [diaLoading, setDiaLoading] = useState(false);
  const [diaResult, setDiaResult] = useState(null);
  const [diaError, setDiaError] = useState("");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  // 휴무충당 모드: "기록" 또는 "신청"
  const [holidayMode, setHolidayMode] = useState("기록");
  const [requests, setRequests] = useState([]); // 신청 목록
  const [confirmModal, setConfirmModal] = useState(null);
  const [toast, setToast] = useState(null);
  // 예쁜 알림창 (toast) - alert 대신 사용
  const showToast = (message, type = "info") => {
    setToast({ message, type: type || "info" });
    setTimeout(() => setToast(null), 2500);
  };

  // 입력 폼 상태
  const [formDate, setFormDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [formShift, setFormShift] = useState("주간");
  const [formFillType, setFormFillType] = useState("다이아");
  const [formDiaNum, setFormDiaNum] = useState("");
  const [formMemo, setFormMemo] = useState("");
  // 교번교체용 상태
  const [swapMembers, setSwapMembers] = useState<any[]>([]);
  const [swapDate, setSwapDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [swapPartner, setSwapPartner] = useState<any>(null);
  const [swapSearch, setSwapSearch] = useState("");
// 교번교체 매칭용: 순환표 + 기간
  const [swapRotation, setSwapRotation] = useState<any[]>([]);
  const [swapStart, setSwapStart] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [swapEnd, setSwapEnd] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [swapMatches, setSwapMatches] = useState<any[]>([]);
 const [swapSearched, setSwapSearched] = useState(false);
  const [receivedSwaps, setReceivedSwaps] = useState<any[]>([]);

  const loadReceivedSwaps = async () => {
    const { data } = await supabase
      .from("kyobun_swap")
      .select("*")
      .eq("b_employee_number", String(user?.employee_number))
      .eq("status", "대기")
      .order("created_at", { ascending: false });
    if (data) setReceivedSwaps(data);
  };
  useEffect(() => { loadReceivedSwaps(); }, []);

  // 순환표 불러오기 (대공원+도봉 둘 다)
  useEffect(() => {
    const loadRotation = async () => {
      const { data } = await supabase
        .from("schedule_rotation")
        .select("*")
        .in("group_name", ["대공원 114", "도봉 41"]);
      if (data) setSwapRotation(data);
    };
    loadRotation();
  }, []);
  // 기관사 명단 불러오기 (교번교체 상대 선택용)
  useEffect(() => {
    const loadSwapMembers = async () => {
      const { data } = await supabase
        .from("members")
        .select("*")
        .in("work_group", ["대공원", "도봉"])
        .order("name");
      if (data) setSwapMembers(data);
    };
    loadSwapMembers();
  }, []);

  // 다이아 번호 범위 (주간/야간)
  const diaRange = formShift === "주간" ? "1~59" : "60~90";
  const diaMin = formShift === "주간" ? 1 : 60;
  const diaMax = formShift === "주간" ? 59 : 90;
  const diaNumValid =
    formFillType === "취급실" ||
    (formDiaNum !== "" &&
      Number(formDiaNum) >= diaMin &&
      Number(formDiaNum) <= diaMax);

 const tabs = ["대기충당", "지정근무", "지원근무", "휴무충당", "교번교체"];
  const tabTypeMap = {
    대기충당: "standby",
    지정근무: "designated",
    지원근무: "support",
    휴무충당: "holiday_fill",
  };

  // 기록 불러오기 (work_adjust 테이블)
  useEffect(() => {
    if (!user?.employee_number) return;
    if (activeTab === "교번교체") return;
    if (activeTab === "휴무충당" && holidayMode === "신청") return;

    const fetchRecords = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("work_adjust")
        .select("*")
        .eq("employee_number", user.employee_number)
        .eq("adjust_type", tabTypeMap[activeTab])
        .order("work_date", { ascending: false });

      if (!error && data) setRecords(data);
      setLoading(false);
    };

    fetchRecords();
  }, [activeTab, user, holidayMode]);

  // 휴무충당 신청 목록 불러오기
  useEffect(() => {
    if (activeTab !== "휴무충당" || holidayMode !== "신청") return;

    const fetchRequests = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("holiday_fill_request")
        .select("*")
        .eq("employee_number", user.employee_number)
        .order("request_date", { ascending: false });

      if (!error && data) setRequests(data);
      setLoading(false);
    };

    fetchRequests();
  }, [activeTab, user, holidayMode]);

  // 저장 (work_adjust - 가계부형 기록)
  const handleSave = async () => {
    if (!user?.employee_number) {
      alert("로그인 정보가 없습니다.");
      return;
    }
    if (!formDate) {
      showToast("날짜를 선택해주세요.");
      return;
    }
    if (formFillType === "다이아") {
      if (!formDiaNum) {
        showToast("다이아 번호를 입력해주세요.");
        return;
      }
      if (Number(formDiaNum) < diaMin || Number(formDiaNum) > diaMax) {
        showToast(`${formShift}은(는) ${diaRange}번 범위입니다.`);
        return;
      }
    }

    const isNight = formShift === "야간";
    const fillInfo =
      formFillType === "다이아" ? `다이아 ${formDiaNum}번` : "취급실";
    const fullMemo = formMemo ? `${fillInfo} · ${formMemo}` : fillInfo;

    const { error } = await supabase.from("work_adjust").insert([
      {
        employee_number: user.employee_number,
        adjust_type: tabTypeMap[activeTab],
        work_date: formDate,
        work_shift: formShift,
        memo: fullMemo,
        is_night: isNight,
      },
    ]);

    if (error) {
      showToast("저장 실패: " + error.message);
      return;
    }

    showToast("저장되었습니다!", "success");
    setFormMemo("");
    setFormDiaNum("");

    const { data } = await supabase
      .from("work_adjust")
      .select("*")
      .eq("employee_number", user.employee_number)
      .eq("adjust_type", tabTypeMap[activeTab])
      .order("work_date", { ascending: false });
    if (data) setRecords(data);
  };

  // 휴무충당가능 (holiday_fill_request)
  const handleRequestSubmit = async () => {
    if (!user?.employee_number) {
      alert("로그인 정보가 없습니다.");
      return;
    }
    if (!formDate) {
      alert("날짜를 선택해주세요.");
      return;
    }

    const { error } = await supabase.from("holiday_fill_request").insert([
      {
        employee_number: user.employee_number,
        request_date: formDate,
        work_shift: formShift,
        memo: formMemo,
        status: "pending",
      },
    ]);

    if (error) {
      showToast("신청 실패: " + error.message);
      return;
    }

    showToast("신청이 접수되었습니다!", "success");
    setFormMemo("");

    const { data } = await supabase
      .from("holiday_fill_request")
      .select("*")
      .eq("employee_number", user.employee_number)
      .order("request_date", { ascending: false });
    if (data) setRequests(data);
  };

  // 삭제 (기록)
  const handleDelete = (id) => {
    setConfirmModal({
      title: "기록 삭제",
      message: "이 기록을 삭제하시겠습니까?",
      confirmText: "삭제",
      onConfirm: async () => {
        const { error } = await supabase
          .from("work_adjust")
          .delete()
          .eq("id", id);
        if (error) {
          alert("삭제 실패: " + error.message);
          return;
        }
        setRecords(records.filter((r) => r.id !== id));
        setConfirmModal(null);
      },
    });
  };

  // 신청 취소
  const handleRequestCancel = (id) => {
    setConfirmModal({
      title: "신청 취소",
      message: "이 신청을 취소하시겠습니까?",
      confirmText: "취소하기",
      onConfirm: async () => {
        const { error } = await supabase
          .from("holiday_fill_request")
          .delete()
          .eq("id", id);
        if (error) {
          alert("취소 실패: " + error.message);
          return;
        }
        setRequests(requests.filter((r) => r.id !== id));
        setConfirmModal(null);
      },
    });
  };

  const shiftColors = {
    주간: { bg: "#FEF3C7", color: "#92400E" },
    야간: { bg: "#DBEAFE", color: "#1E40AF" },
    비번: { bg: "#E5E7EB", color: "#374151" },
    휴무: { bg: "#FCE7F3", color: "#9D174D" },
  };

  const statusInfo = {
    pending: { label: "⏳ 대기중", bg: "#FEF3C7", color: "#92400E" },
    approved: { label: "✅ 승인", bg: "#D1FAE5", color: "#065F46" },
    rejected: { label: "❌ 거절", bg: "#FEE2E2", color: "#991B1B" },
  };

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
        overflowX: "hidden",
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              대공원승무지회
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              근무조정
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 4,
              }}
            >
              근무 기록 ·{" "}
              <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                가계부처럼 관리해요 📋
              </span>
            </div>
          </div>
        </div>
        {/* 탭 */}
        <div style={{ display: "flex", gap: 4 }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "9px 2px",
                borderRadius: 12,
                border: "2px solid",
                borderColor:
                  activeTab === tab ? "#fff" : "rgba(255,255,255,0.3)",
                background:
                  activeTab === tab ? "#fff" : "rgba(255,255,255,0.1)",
                color: activeTab === tab ? "#4F46E5" : "#fff",
                fontWeight: activeTab === tab ? 700 : 400,
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        {/* 휴무충당 모드 전환 */}
        {activeTab === "휴무충당" && (
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
              padding: 4,
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            }}
          >
            <button
              onClick={() => setHolidayMode("기록")}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 10,
                border: "none",
                background:
                  holidayMode === "기록"
                    ? "linear-gradient(135deg, #4F46E5 0%, #6D28D9 100%)"
                    : "transparent",
                color: holidayMode === "기록" ? "#fff" : "#6B7280",
                fontSize: 13,
                fontWeight: holidayMode === "기록" ? 700 : 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              📝 기록
            </button>
            <button
              onClick={() => setHolidayMode("신청")}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 10,
                border: "none",
                background:
                  holidayMode === "신청"
                    ? "linear-gradient(135deg, #4F46E5 0%, #6D28D9 100%)"
                    : "transparent",
                color: holidayMode === "신청" ? "#fff" : "#6B7280",
                fontSize: 13,
                fontWeight: holidayMode === "신청" ? 700 : 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              📅 신청
            </button>
          </div>
        )}

        {/* 안내 박스 */}
        <div
          style={{
            background: "#EEF0FF",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 13,
            color: "#4F46E5",
          }}
        >
          {activeTab === "휴무충당" && holidayMode === "신청"
            ? "📨 신청 후 사업소 관리자가 확인합니다."
            : "💡 야간 근무는 자동으로 임금계산기에 반영됩니다."}
        </div>

       {/* 다이아 입력 */}
        {activeTab === "다이아" ? (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 8px rgba(79,70,229,0.06)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1F2937", marginBottom: 16 }}>교번 다이아 시간표 등록</div>
            <label style={{ display: "block", padding: 16, border: "2px dashed #C7D2FE", borderRadius: 12, textAlign: "center", cursor: "pointer", color: "#4F46E5", fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              {diaPhoto ? "사진 다시 선택" : "📷 다이아 시간표 사진 선택"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => { setDiaPhoto(String(reader.result)); setDiaResult(null); setDiaError(""); };
                reader.readAsDataURL(f);
              }} />
            </label>
            {diaPhoto && (<img src={diaPhoto} alt="미리보기" style={{ width: "100%", borderRadius: 12, marginBottom: 12 }} />)}
            {diaPhoto && !diaResult && (
              <button disabled={diaLoading} onClick={async () => {
                setDiaLoading(true); setDiaError("");
                try {
                  const comma = diaPhoto.indexOf(",");
                  const meta = diaPhoto.slice(5, diaPhoto.indexOf(";"));
                  const b64 = diaPhoto.slice(comma + 1);
                  const r = await fetch("/.netlify/functions/read-dia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: b64, mediaType: meta }) });
                  const d = await r.json();
                  if (d.error) throw new Error(d.error);
                  const txt = (d.text || "").replace(/```json|```/g, "").trim();
                  setDiaResult(JSON.parse(txt));
                } catch (err) { setDiaError("읽기 실패: " + String(err)); }
                setDiaLoading(false);
              }} style={{ width: "100%", padding: 14, background: diaLoading ? "#9CA3AF" : "linear-gradient(135deg,#4F46E5,#6366F1)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                {diaLoading ? "AI가 읽는 중..." : "AI로 읽기"}
              </button>
            )}
            {diaError && <div style={{ color: "#DC2626", fontSize: 13, marginTop: 10 }}>{diaError}</div>}
            {diaResult && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1F2937", marginBottom: 10 }}>읽은 결과 (수정 가능)</div>
                {[["dia_no","다이아번호"],["distance_km","주행키로"],["start_time","출근시간"],["work_hours","인정근무"],["drive_hours","운전"],["wait_hours","대기"],["ride_hours","편승"],["watch_hours","감시"],["edu_hours","교육"],["prep_hours","준비"],["clean_hours","정리"],["night_hours","심야"]].map(([k, label]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 70, fontSize: 12, color: "#6B7280" }}>{label}</span>
                    <input value={diaResult[k] ?? ""} onChange={(e) => setDiaResult({ ...diaResult, [k]: e.target.value })} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #E5E7EB", fontSize: 13, fontFamily: "inherit", color: "#1F2937" }} />
                  </div>
                ))}
                <button onClick={async () => {
                  setDiaLoading(true);
                  try {
                    const row = {
                      dia_no: Number(diaResult.dia_no) || 0,
                      distance_km: Number(diaResult.distance_km) || 0,
                      start_time: String(diaResult.start_time || ""),
                      work_hours: Number(diaResult.work_hours) || 0,
                      drive_hours: Number(diaResult.drive_hours) || 0,
                      wait_hours: Number(diaResult.wait_hours) || 0,
                      ride_hours: Number(diaResult.ride_hours) || 0,
                      watch_hours: Number(diaResult.watch_hours) || 0,
                      edu_hours: Number(diaResult.edu_hours) || 0,
                      prep_hours: Number(diaResult.prep_hours) || 0,
                      clean_hours: Number(diaResult.clean_hours) || 0,
                      night_hours: Number(diaResult.night_hours) || 0,
                      photo: diaPhoto || "",
                    };
                    const { error } = await supabase.from("kyobun_dia").upsert(row);
                    if (error) throw new Error(error.message);
                    showToast("다이아 " + row.dia_no + "번 저장됨!", "success");
                    setDiaPhoto(null); setDiaResult(null);
                  } catch (err) { setDiaError("저장 실패: " + String(err)); }
                  setDiaLoading(false);
                }} style={{ width: "100%", marginTop: 8, padding: 14, background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  이대로 저장
                </button>
              </div>
            )}
          </div>
        ) : activeTab === "교번교체" ? (
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "20px",
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: "#1F2937", marginBottom: 8 }}>
             {receivedSwaps.length > 0 && (
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #F3F4F6" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#1F2937", marginBottom: 12 }}>
                  📥 나에게 온 교체 요청
                </div>
                {receivedSwaps.map((req) => (
                  <div key={req.id} style={{ background: "#F9FAFB", borderRadius: 12, padding: "14px", marginBottom: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1F2937", marginBottom: 4 }}>
                      {req.a_name} 기관사
                    </div>
                    <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
                      교체 요청일: {req.swap_date}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={async () => {
                          const { error } = await supabase
                            .from("kyobun_swap")
                            .update({ status: "수락" })
                            .eq("id", req.id);
                          if (error) { showToast("처리 실패: " + error.message, "error"); return; }
                          showToast("교체를 수락했어요", "success");
                          loadReceivedSwaps();
                        }}
                        style={{ flex: 1, padding: "11px", borderRadius: 10, border: "none", background: "linear-gradient(90deg,#4F46E5,#6D28D9)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        수락
                      </button>
                      <button
                        onClick={async () => {
                          const { error } = await supabase
                            .from("kyobun_swap")
                            .update({ status: "거절" })
                            .eq("id", req.id);
                          if (error) { showToast("처리 실패: " + error.message, "error"); return; }
                          showToast("교체를 거절했어요", "info");
                          loadReceivedSwaps();
                        }}
                        style={{ flex: 1, padding: "11px", borderRadius: 10, border: "1px solid #E5E7EB", background: "#fff", color: "#6B7280", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        거절
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
              🔄 교번교체 요청
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16, lineHeight: 1.5 }}>
              교체할 기간을 정하면, 그 기간에 나와 주·야·비·휴 갯수가 같은 기관사를 찾아드려요.
            </div>

            {/* 기간 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 7 }}>시작일</div>
                <input
                  type="date"
                  value={swapStart}
                  onChange={(e) => setSwapStart(e.target.value)}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 14, boxSizing: "border-box", WebkitAppearance: "none", appearance: "none", fontFamily: "inherit" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 7 }}>종료일</div>
                <input
                  type="date"
                  value={swapEnd}
                  onChange={(e) => setSwapEnd(e.target.value)}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #E5E7EB", fontSize: 14, boxSizing: "border-box", WebkitAppearance: "none", appearance: "none", fontFamily: "inherit" }}
                />
              </div>
            </div>

            {/* 매칭 찾기 버튼 */}
            <button
              onClick={() => {
                const me = swapMembers.find(
                  (m) => String(m.employee_number) === String(user?.employee_number)
                );
                if (!me) { showToast("내 정보를 찾을 수 없어요", "error"); return; }
                const s = new Date(swapStart), e = new Date(swapEnd);
                if (e < s) { showToast("종료일이 시작일보다 빠를 수 없어요", "error"); return; }

                // 갯수 세는 함수
                const countTypes = (member: any) => {
                  const c: any = { 주간: 0, 야간: 0, 비번: 0, 휴무: 0 };
                  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
                    const w = calcKyobunWork(member, new Date(d), swapRotation);
                    if (w && c[w.type] !== undefined) c[w.type]++;
                  }
                  return c;
                };
                const same = (a: any, b: any) =>
                  a.주간 === b.주간 && a.야간 === b.야간 && a.비번 === b.비번 && a.휴무 === b.휴무;

                const myCount = countTypes(me);
                const matched = swapMembers
                  .filter((m) => String(m.employee_number) !== String(user?.employee_number))
                  .map((m) => ({ member: m, count: countTypes(m) }))
                  .filter((x) => same(x.count, myCount));

                setSwapMatches(matched);
                setSwapSearched(true);
                setSwapPartner(null);
              }}
              style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", background: "#EEF2FF", color: "#4F46E5", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginBottom: 16 }}
            >
              🔍 갯수 맞는 기관사 찾기
            </button>

            {/* 매칭 결과 */}
            {swapSearched && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8 }}>
                  매칭된 기관사 ({swapMatches.length}명)
                </div>
                {swapMatches.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#9CA3AF", textAlign: "center", padding: "16px 0" }}>
                    이 기간에 갯수가 같은 기관사가 없어요
                  </div>
                ) : (
                  swapMatches.map((x) => {
                    const isOpen = swapPartner?.employee_number === x.member.employee_number;
                    const me = swapMembers.find(
                      (m) => String(m.employee_number) === String(user?.employee_number)
                    );
                    const days: any[] = [];
                    if (isOpen && me) {
                      const s = new Date(swapStart), e = new Date(swapEnd);
                      const fmt = (w: any) =>
                        !w ? "-" : w.type === "휴무" ? "휴" : w.type === "비번" ? "비" : w.dia;
                      const from = new Date(s); from.setDate(from.getDate() - 1);
                      const to = new Date(e); to.setDate(to.getDate() + 1);
                      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                        const dd = new Date(d);
                        const isEdge = dd < s || dd > e;
                        days.push({
                          label: `${dd.getMonth() + 1}/${dd.getDate()}`,
                          mine: fmt(calcKyobunWork(me, dd, swapRotation)),
                          theirs: fmt(calcKyobunWork(x.member, dd, swapRotation)),
                          edge: isEdge,
                        });
                      }
                    }
                    return (
                      <div
                        key={x.member.employee_number}
                        style={{
                          marginBottom: 6, borderRadius: 12,
                          border: isOpen ? "2px solid #6366F1" : "1px solid #E5E7EB",
                          background: isOpen ? "#F5F7FF" : "#fff",
                          overflow: "hidden",
                        }}
                      >
                        <button
                          onClick={() => setSwapPartner(isOpen ? null : x.member)}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            padding: "12px 14px", border: "none", background: "none",
                            cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                         <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#4F46E5", flexShrink: 0 }}>
                              {x.member.name?.charAt(0)}
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 700, color: "#1F2937" }}>
                              {x.member.name} <span style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 400 }}>({x.member.work_group})</span>
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 3 }}>
                            주{x.count.주간} 야{x.count.야간} 비{x.count.비번} 휴{x.count.휴무}
                          </div>
                        </button>

                        {isOpen && (
                          <div style={{ padding: "0 14px 12px", overflowX: "auto" }}>
                            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
                              <tbody>
                                <tr>
                                  <td style={{ padding: "5px 8px 5px 0", color: "#9CA3AF", fontSize: 11, whiteSpace: "nowrap" }}>날짜</td>
                                  {days.map((row, i) => (
                                    <td key={i} style={{ textAlign: "center", color: row.edge ? "#C7C9CF" : "#9CA3AF", fontSize: 11, padding: "5px 6px", whiteSpace: "nowrap" }}>{row.label}</td>
                                  ))}
                                </tr>
                                <tr style={{ borderTop: "1px solid #EEF0F3" }}>
                                  <td style={{ padding: "6px 8px 6px 0", color: "#6B7280", whiteSpace: "nowrap" }}>내 다이아</td>
                                  {days.map((row, i) => (
                                    <td key={i} style={{ textAlign: "center", fontWeight: 600, color: row.edge ? "#C7C9CF" : "#374151", padding: "6px" }}>{row.mine}</td>
                                  ))}
                                </tr>
                                <tr style={{ borderTop: "1px solid #EEF0F3" }}>
                                  <td style={{ padding: "6px 8px 6px 0", color: "#4F46E5", fontWeight: 600, whiteSpace: "nowrap" }}>상대 다이아</td>
                                  {days.map((row, i) => (
                                    <td key={i} style={{ textAlign: "center", fontWeight: 600, color: row.edge ? "#B9BDEA" : "#4F46E5", padding: "6px" }}>{row.theirs}</td>
                                  ))}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          )}
                          {isOpen && (
                            <div style={{ padding: "0 14px 14px" }}>
                            <button
                              onClick={async () => {
                                const { error } = await supabase.from("kyobun_swap").insert([{
                                  swap_date: swapStart,
                                  a_employee_number: String(user?.employee_number),
                                  a_name: user?.name,
                                  b_employee_number: String(x.member.employee_number),
                                  b_name: x.member.name,
                                  status: "대기",
                                }]);
                                if (error) { showToast("요청 실패: " + error.message, "error"); return; }
                                showToast("교체 요청을 보냈어요", "success");
                                setSwapPartner(null);
                                setSwapSearched(false);
                                setSwapMatches([]);
                              }}
                              style={{ width: "100%", padding: "13px", borderRadius: 12, border: "none", background: "linear-gradient(90deg,#4F46E5,#6D28D9)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                            >
                              🔄 교체 요청 보내기
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}         
          </div>
        ) : activeTab === "휴무충당" && holidayMode === "신청" ? (
          // ─────── 휴무충당 신청 모드 ───────
          <>
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                padding: "20px",
                boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 16,
                }}
              >
                📨 휴무충당 신청
              </div>

              {/* 날짜 */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 7,
                  }}
                >
                  신청 날짜
                </div>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1.5px solid #E5E7EB",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#1F2937",
                    background: "#fff",
                    maxWidth: "100%",
                  }}
                />
              </div>

              {/* 주간/야간 */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 7,
                  }}
                >
                  근무 종류
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["주간", "야간"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setFormShift(s)}
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 10,
                        border:
                          formShift === s
                            ? "2px solid #4F46E5"
                            : "1.5px solid #E5E7EB",
                        background: formShift === s ? "#EEF0FF" : "#fff",
                        color: formShift === s ? "#4F46E5" : "#6B7280",
                        fontWeight: formShift === s ? 700 : 500,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* 신청 버튼 */}
              <button
                onClick={handleRequestSubmit}
                style={{
                  width: "100%",
                  padding: "14px",
                  borderRadius: 12,
                  border: "none",
                  background:
                    "linear-gradient(135deg, #4F46E5 0%, #6D28D9 100%)",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                📨 신청하기
              </button>
            </div>

            {/* 신청 목록 */}
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                padding: "20px",
                boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>📋 내 신청</span>
                <span
                  style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 500 }}
                >
                  총 {requests.length}건
                </span>
              </div>

              {loading ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 30,
                    color: "#9CA3AF",
                    fontSize: 13,
                  }}
                >
                  불러오는 중...
                </div>
              ) : requests.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 30,
                    color: "#9CA3AF",
                    fontSize: 13,
                  }}
                >
                  아직 신청이 없어요 📝
                </div>
              ) : (
                requests.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid #F3F4F6",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#1F2937",
                          }}
                        >
                          {r.request_date}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background:
                              shiftColors[r.work_shift]?.bg || "#E5E7EB",
                            color:
                              shiftColors[r.work_shift]?.color || "#374151",
                          }}
                        >
                          {r.work_shift}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: statusInfo[r.status]?.bg || "#E5E7EB",
                            color: statusInfo[r.status]?.color || "#374151",
                          }}
                        >
                          {statusInfo[r.status]?.label || r.status}
                        </span>
                      </div>
                      {r.memo && (
                        <div style={{ fontSize: 12, color: "#6B7280" }}>
                          {r.memo}
                        </div>
                      )}
                      {r.admin_memo && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#991B1B",
                            marginTop: 4,
                            fontStyle: "italic",
                          }}
                        >
                          관리자: {r.admin_memo}
                        </div>
                      )}
                    </div>
                    {r.status === "pending" && (
                      <button
                        onClick={() => handleRequestCancel(r.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#EF4444",
                          fontSize: 18,
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          // ─────── 대기충당/지정근무/지원근무/휴무충당 기록 모드 ───────
          <>
            {(() => {
              const COLOR: any = {
                대기충당: "#6D28D9", 지정근무: "#0F6E56", 지원근무: "#185FA5", 휴무충당: "#854F0B",
              };
              const c = COLOR[activeTab] || "#4F46E5";
              const y = new Date().getFullYear();
              const yearRecs = records.filter((r) => (r.work_date || "").startsWith(`${y}-`));
              const dayCnt = yearRecs.filter((r) => r.work_shift === "주간").length;
              const nightCnt = yearRecs.filter((r) => r.work_shift === "야간").length;
              return (
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 20,
                    padding: "16px 18px",
                    boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1F2937" }}>올해 {activeTab}</span>
                    <span style={{ fontSize: 10, color: "#9CA3AF" }}>{y}.1.1 ~ 오늘</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 10 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: c }}>{yearRecs.length}</span>
                    <span style={{ fontSize: 12, color: "#6B7280" }}>회</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, borderTop: "0.5px solid #EEF0F3", paddingTop: 10 }}>
                    <div style={{ flex: 1, background: "#F9FAFB", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>주간</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2937" }}>{dayCnt}</div>
                    </div>
                    <div style={{ flex: 1, background: "#F9FAFB", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 2 }}>야간</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#1F2937" }}>{nightCnt}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                padding: "20px",
                boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 16,
                }}
              >
                ✍️ {activeTab} 기록
              </div>

              {/* 날짜 */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 7,
                  }}
                >
                  날짜
                </div>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1.5px solid #E5E7EB",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#1F2937",
                    background: "#fff",
                    maxWidth: "100%",
                    WebkitAppearance: "none",
appearance: "none",
                  }}
                />
              </div>

              {/* 근무 종류 */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 7,
                  }}
                >
                  근무 종류
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["주간", "야간"].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setFormShift(s);
                        setFormDiaNum("");
                      }}
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 10,
                        border:
                          formShift === s
                            ? "2px solid #4F46E5"
                            : "1.5px solid #E5E7EB",
                        background: formShift === s ? "#EEF0FF" : "#fff",
                        color: formShift === s ? "#4F46E5" : "#6B7280",
                        fontWeight: formShift === s ? 700 : 500,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* 충당 종류 */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 7,
                  }}
                >
                  충당 종류
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["다이아", "취급실"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setFormFillType(s)}
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        borderRadius: 10,
                        border:
                          formFillType === s
                            ? "2px solid #4F46E5"
                            : "1.5px solid #E5E7EB",
                        background: formFillType === s ? "#EEF0FF" : "#fff",
                        color: formFillType === s ? "#4F46E5" : "#6B7280",
                        fontWeight: formFillType === s ? 700 : 500,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* 다이아 번호 */}
              {formFillType === "다이아" && (
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      marginBottom: 7,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>다이아 번호</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "#9CA3AF",
                        fontWeight: 500,
                      }}
                    >
                      {formShift} 범위: {diaRange}번
                    </span>
                  </div>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={diaMin}
                    max={diaMax}
                    value={formDiaNum}
                    onChange={(e) => setFormDiaNum(e.target.value)}
                    placeholder={`${diaMin} ~ ${diaMax}`}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 12,
                      border:
                        formDiaNum && !diaNumValid
                          ? "1.5px solid #EF4444"
                          : "1.5px solid #E5E7EB",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      color: "#1F2937",
                    }}
                  />
                  {formDiaNum && !diaNumValid && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#EF4444",
                        marginTop: 5,
                      }}
                    >
                      ⚠️ {formShift}은(는) {diaRange}번 범위입니다.
                    </div>
                  )}
                </div>
              )}

              {/* 메모 */}
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 7,
                  }}
                >
                  메모 (선택)
                </div>
                <textarea
                  value={formMemo}
                  onChange={(e) => setFormMemo(e.target.value)}
                  placeholder="예: 김OO과 교환, 특근 사유 등"
                  style={{
                    width: "100%",
                    minHeight: 60,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1.5px solid #E5E7EB",
                    fontSize: 14,
                    outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    color: "#1F2937",
                    resize: "vertical",
                  }}
                />
              </div>

              {/* 저장 버튼 */}
              <button
                onClick={handleSave}
                style={{
                  width: "100%",
                  padding: "14px",
                  borderRadius: 12,
                  border: "none",
                  background:
                    "linear-gradient(135deg, #4F46E5 0%, #6D28D9 100%)",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                💾 기록 저장
              </button>
            </div>

           {(() => {
            const _now = new Date();
            const _ym = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;
            const monthRecords = records.filter((r) => (r.work_date || "").startsWith(_ym));
            return (
            <>
            {/* 기록 목록 */}
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                padding: "20px",
                boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>📋 내 기록</span>
                <span
                  style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 500 }}
                >
           총 {monthRecords.length}건
                </span>
              </div>

              {loading ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 30,
                    color: "#9CA3AF",
                    fontSize: 13,
                  }}
                >
                  불러오는 중...
                </div>
              ) : monthRecords.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 30,
                    color: "#9CA3AF",
                    fontSize: 13,
                  }}
                >
                  아직 기록이 없어요 📝
                </div>
              ) : (
                monthRecords.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      padding: "12px 0",
                      borderBottom: "1px solid #F3F4F6",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#1F2937",
                          }}
                        >
                          {r.work_date}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 6,
                            background:
                              shiftColors[r.work_shift]?.bg || "#E5E7EB",
                            color:
                              shiftColors[r.work_shift]?.color || "#374151",
                          }}
                        >
                          {r.work_shift}
                        </span>
                        {r.is_night && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "#4F46E5",
                              fontWeight: 700,
                            }}
                          >
                            💰
                          </span>
                        )}
                      </div>
                      {r.memo && (
                        <div style={{ fontSize: 12, color: "#6B7280" }}>
                          {r.memo}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(r.id)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#EF4444",
                        fontSize: 18,
                        cursor: "pointer",
                        padding: 4,
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </div>
              </>
            );
            })()}
          </>
        )}
      </div>
      {/* 삭제/취소 확인 모달 */}
      {confirmModal && (
        <div
          onClick={() => setConfirmModal(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "24px 20px",
              width: "100%",
              maxWidth: 320,
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: "#1F2937",
                marginBottom: 8,
              }}
            >
              {confirmModal.title}
            </div>
            <div
              style={{
                fontSize: 14,
                color: "#6B7280",
                marginBottom: 24,
                lineHeight: 1.5,
              }}
            >
              {confirmModal.message}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmModal(null)}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  border: "1.5px solid #E5E7EB",
                  background: "#fff",
                  color: "#6B7280",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                닫기
              </button>
              <button
                onClick={confirmModal.onConfirm}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  border: "none",
                  background: "#EF4444",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {confirmModal.confirmText || "확인"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 알림 toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            marginTop: 15,
            left: "50%",
            transform: "translateX(-50%)",
            background: toast.type === "success" ? "#10B981" : "#1F2937",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
            zIndex: 1100,
            maxWidth: "85%",
            textAlign: "center",
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ── 공지사항 목록 ──
function NoticeList({ notices, onBack, onSelect }) {
  const [filter, setFilter] = useState("전체");
  const filtered =
    filter === "전체" ? notices : notices.filter((n) => n.tag === filter);
  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
              서울교통공사노동조합
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
              공지사항
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 4,
              }}
            >
              소통하는 노조 ·{" "}
              <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                함께하는 조합원
              </span>
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          background: "#fff",
          padding: "12px 16px",
          display: "flex",
          gap: 8,
          marginBottom: 8,
        }}
      >
        {["전체", "긴급", "공지"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background: filter === f ? "#4F46E5" : "#F3F4F6",
              color: filter === f ? "#fff" : "#6B7280",
            }}
          >
            {f}
          </button>
        ))}
      </div>
      <div style={{ background: "#fff" }}>
        {filtered.map((n, i) => (
          <div
            key={n.id}
            onClick={() => onSelect(n)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "16px 20px",
              borderBottom:
                i < filtered.length - 1 ? "1px solid #F3F4F6" : "none",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                background: n.tagBg,
                color: n.tagColor,
                fontSize: 11,
                fontWeight: 700,
                borderRadius: 6,
                padding: "3px 8px",
                whiteSpace: "nowrap",
              }}
            >
              {n.tag}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#1F2937",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {n.title}
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 3 }}>
                {n.date}
              </div>
            </div>
            <span style={{ color: "#D1D5DB", fontSize: 18, flexShrink: 0 }}>
              ›
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// 승무일지 (LogbookScreen) - 1단계
// 위치: LeaveScreen 컴포넌트 근처에 추가
// ============================================

// 1) 더미 데이터 (LogbookScreen 함수 바로 위에 추가)
const myDummyLogs = [
  {
    id: 1,
    date: "2026-05-18",
    section: "충정로↔홍대입구",
    trainNo: "3214",
    issue: "ATS 통신 일시 단절",
    action: "관제실 연락 후 5분 만에 정상화",
  },
  {
    id: 2,
    date: "2026-05-15",
    section: "왕십리↔잠실",
    trainNo: "2107",
    issue: "1호차 출입문 닫힘 불량",
    action: "재시도 후 정상 작동, 차량사업소 통보",
  },
  {
    id: 3,
    date: "2026-05-12",
    section: "신도림↔구로",
    trainNo: "1098",
    issue: "비상등 점멸 현상",
    action: "회차 후 차량사업소 인계",
  },
  {
    id: 4,
    date: "2026-05-08",
    section: "사당↔서울대입구",
    trainNo: "4421",
    issue: "안내방송 음량 저하",
    action: "방송장치 재설정으로 정상화",
  },
];

// 2) LogbookScreen 컴포넌트
function LogbookScreen({ goBack }: { goBack: () => void }) {
  const [mode, setMode] = React.useState<"list" | "write" | "detail">("list");
  const [logs, setLogs] = React.useState(myDummyLogs);
  const [selectedLog, setSelectedLog] = React.useState<any>(null);

  // 작성 폼 상태
  const [formDate, setFormDate] = React.useState(
    new Date().toISOString().split("T")[0]
  );
  const [formSection, setFormSection] = React.useState("");
  const [formTrainNo, setFormTrainNo] = React.useState("");
  const [formIssue, setFormIssue] = React.useState("");
  const [formAction, setFormAction] = React.useState("");

  const resetForm = () => {
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormSection("");
    setFormTrainNo("");
    setFormIssue("");
    setFormAction("");
  };

  const handleSubmit = () => {
    if (!formDate || !formSection || !formIssue) {
      alert("일자, 운전구간, 고장·문제는 필수 입력입니다");
      return;
    }
    const newLog = {
      id: Date.now(),
      date: formDate,
      section: formSection,
      trainNo: formTrainNo,
      issue: formIssue,
      action: formAction,
    };
    setLogs([newLog, ...logs]);
    resetForm();
    setMode("list");
    alert("승무일지가 저장되었습니다");
  };

  const handleDelete = (id: number) => {
    if (!confirm("이 일지를 삭제할까요?")) return;
    setLogs(logs.filter((l) => l.id !== id));
    setSelectedLog(null);
    setMode("list");
  };

  // ========== 상세 보기 ==========
  if (mode === "detail" && selectedLog) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f5f5" }}>
        {/* 헤더 */}
        <div
          style={{
            background: "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)",
            color: "white",
            padding: "20px 16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <button
            onClick={() => {
              setMode("list");
              setSelectedLog(null);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "white",
              fontSize: "20px",
              cursor: "pointer",
              padding: 0,
            }}
          >
            ←
          </button>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            승무일지 상세
          </h2>
        </div>

        {/* 본문 */}
        <div style={{ padding: "16px" }}>
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ marginBottom: "16px" }}>
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
              >
                📅 일자
              </div>
              <div style={{ fontSize: "16px", fontWeight: 600 }}>
                {selectedLog.date}
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
              >
                🚇 운전구간
              </div>
              <div style={{ fontSize: "16px" }}>{selectedLog.section}</div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
              >
                🚆 차량번호
              </div>
              <div style={{ fontSize: "16px" }}>
                {selectedLog.trainNo || "-"}
              </div>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
              >
                ⚠️ 고장·문제
              </div>
              <div
                style={{
                  fontSize: "15px",
                  padding: "12px",
                  background: "#fef2f2",
                  borderRadius: "8px",
                  border: "1px solid #fecaca",
                  lineHeight: 1.6,
                }}
              >
                {selectedLog.issue}
              </div>
            </div>

            <div>
              <div
                style={{ fontSize: "12px", color: "#666", marginBottom: "4px" }}
              >
                ✅ 조치
              </div>
              <div
                style={{
                  fontSize: "15px",
                  padding: "12px",
                  background: "#f0fdf4",
                  borderRadius: "8px",
                  border: "1px solid #bbf7d0",
                  lineHeight: 1.6,
                }}
              >
                {selectedLog.action || "-"}
              </div>
            </div>
          </div>

          {/* 삭제 버튼 */}
          <button
            onClick={() => handleDelete(selectedLog.id)}
            style={{
              width: "100%",
              marginTop: "16px",
              padding: "14px",
              background: "white",
              color: "#dc2626",
              border: "1px solid #fecaca",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            🗑️ 일지 삭제
          </button>
        </div>
      </div>
    );
  }

  // ========== 작성 모드 ==========
  if (mode === "write") {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f5f5" }}>
        {/* 헤더 */}
        <div
          style={{
            background: "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)",
            color: "white",
            padding: "20px 16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <button
            onClick={() => {
              setMode("list");
              resetForm();
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "white",
              fontSize: "20px",
              cursor: "pointer",
              padding: 0,
            }}
          >
            ←
          </button>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            승무일지 작성
          </h2>
        </div>

        {/* 폼 */}
        <div style={{ padding: "16px" }}>
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            {/* 일자 */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  color: "#374151",
                  marginBottom: "6px",
                  fontWeight: 500,
                }}
              >
                📅 일자 <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* 운전구간 */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  color: "#374151",
                  marginBottom: "6px",
                  fontWeight: 500,
                }}
              >
                🚇 운전구간 <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                type="text"
                value={formSection}
                onChange={(e) => setFormSection(e.target.value)}
                placeholder="예: 충정로↔홍대입구"
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* 차량번호 */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  color: "#374151",
                  marginBottom: "6px",
                  fontWeight: 500,
                }}
              >
                🚆 차량번호
              </label>
              <input
                type="text"
                value={formTrainNo}
                onChange={(e) => setFormTrainNo(e.target.value)}
                placeholder="예: 3214"
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* 고장·문제 */}
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  color: "#374151",
                  marginBottom: "6px",
                  fontWeight: 500,
                }}
              >
                ⚠️ 고장·문제 <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <textarea
                value={formIssue}
                onChange={(e) => setFormIssue(e.target.value)}
                placeholder="발생한 고장이나 문제점을 입력하세요"
                rows={4}
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {/* 조치 */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  color: "#374151",
                  marginBottom: "6px",
                  fontWeight: 500,
                }}
              >
                ✅ 조치
              </label>
              <textarea
                value={formAction}
                onChange={(e) => setFormAction(e.target.value)}
                placeholder="취한 조치나 처리 결과를 입력하세요"
                rows={4}
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  fontSize: "15px",
                  boxSizing: "border-box",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>
          </div>

          {/* 저장 버튼 */}
          <button
            onClick={handleSubmit}
            style={{
              width: "100%",
              marginTop: "16px",
              padding: "14px",
              background: "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)",
              color: "white",
              border: "none",
              borderRadius: "10px",
              fontSize: "15px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            💾 일지 저장
          </button>
        </div>
      </div>
    );
  }

  // ========== 리스트 (기본) ==========
  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5" }}>
      {/* 헤더 */}
      <div
        style={{
          background: "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)",
          color: "white",
          padding: "20px 16px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <button
          onClick={goBack}
          style={{
            background: "transparent",
            border: "none",
            color: "white",
            fontSize: "20px",
            cursor: "pointer",
            padding: 0,
          }}
        >
          ←
        </button>
        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, flex: 1 }}>
          📝 승무일지
        </h2>
      </div>

      {/* 안내 박스 */}
      <div style={{ padding: "16px" }}>
        <div
          style={{
            background: "white",
            borderRadius: "10px",
            padding: "12px 14px",
            fontSize: "13px",
            color: "#475569",
            border: "1px solid #e2e8f0",
            marginBottom: "12px",
            lineHeight: 1.5,
          }}
        >
          🔒 본인만 확인 가능한 개인 일지입니다.
          <br />
          근무 중 발생한 기기 고장이나 문제점을 기록하세요.
        </div>

        {/* 일지 개수 */}
        <div
          style={{
            fontSize: "13px",
            color: "#64748b",
            marginBottom: "10px",
            padding: "0 4px",
          }}
        >
          전체 <strong style={{ color: "#1e3a8a" }}>{logs.length}</strong>건
        </div>

        {/* 리스트 */}
        {logs.length === 0 ? (
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "40px 20px",
              textAlign: "center",
              color: "#94a3b8",
            }}
          >
            아직 작성된 일지가 없습니다
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {logs.map((log) => (
              <div
                key={log.id}
                onClick={() => {
                  setSelectedLog(log);
                  setMode("detail");
                }}
                style={{
                  background: "white",
                  borderRadius: "12px",
                  padding: "14px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  cursor: "pointer",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#1e3a8a",
                      fontWeight: 600,
                    }}
                  >
                    📅 {log.date}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    🚆 {log.trainNo || "-"}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "#475569",
                    marginBottom: "6px",
                  }}
                >
                  🚇 {log.section}
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    color: "#1e293b",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  ⚠️ {log.issue}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 작성 플로팅 버튼 */}
      <button
        onClick={() => setMode("write")}
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)",
          color: "white",
          border: "none",
          fontSize: "28px",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(30, 58, 138, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        +
      </button>
    </div>
  );
}
// ============================================
// 홈 캐러셀 (HomeCarousel) - 1단계
// 위치: LogbookScreen 함수 다음에 추가
// 기능: 자동 슬라이드(4초) + 스와이프 + 점 클릭
// ============================================

// 1) 더미 데이터 (HomeCarousel 함수 바로 위에 추가)
const dummyTopUsers = [
  { rank: 1, memberId: "042", count: 152 },
  { rank: 2, memberId: "018", count: 148 },
  { rank: 3, memberId: "129", count: 131 },
];

const dummyCondolences = [
  { name: "김조합", type: "결혼", date: "2026-05-25", relation: "본인" },
  { name: "이승무", type: "부친상", date: "2026-05-19", relation: "본인" },
];

// 2) HomeCarousel 컴포넌트
function HomeCarousel({
  urgentNotice,
  onUrgentClick,
  carouselNotices = [],
  onCondolenceClick,
  user,
}: {
  urgentNotice?: any;
  carouselNotices?: any[];
  onUrgentClick: () => void;
  onCondolenceClick: () => void;
  user?: any;
}) {
  // 경조사 데이터 (Supabase events에서)
  const [condolences, setCondolences] = React.useState([]);
const [topUsers, setTopUsers] = React.useState<any[]>([]);
  const [myRank, setMyRank] = React.useState<any>(null);

  React.useEffect(() => {
    const loadTop = async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data } = await supabase
        .from("user_points")
        .select("employee_number, point, created_at")
        .gte("created_at", monthStart);
      if (!data) return;
      const sums: any = {};
      data.forEach((r: any) => {
        sums[r.employee_number] = (sums[r.employee_number] || 0) + (r.point || 0);
      });
      const ranked = Object.entries(sums)
        .map(([emp, total]) => ({ emp, total: total as number }))
        .sort((a, b) => b.total - a.total);
      const myId = String(user?.emp_id || user?.id || "");
      const myIdx = ranked.findIndex((r) => r.emp === myId);
      setMyRank(myIdx >= 0 ? { rank: myIdx + 1, total: ranked[myIdx].total } : null);
      setTopUsers(
        ranked.slice(0, 3).map((r, i) => ({
          rank: i + 1,
          emp: r.emp,
          total: r.total,
          isMe: r.emp === myId,
        }))
      );
    };
    loadTop();
  }, [user]);
  React.useEffect(() => {
    const loadCondolences = async () => {
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("is_active", true)
        .order("event_date", { ascending: false });
      const formatted = (data || []).map((e) => ({
        name: e.member_name,
        type: e.event_type,
        date: e.event_date,
      }));
      setCondolences(formatted);
    };
    loadCondolences();
  }, []);
  const [index, setIndex] = React.useState(0);
  const realIndex = index % 3;
  const [touchStart, setTouchStart] = React.useState<number | null>(null);
  const [touchEnd, setTouchEnd] = React.useState<number | null>(null);
  const [isPaused, setIsPaused] = React.useState(false);
  const [transitionOn, setTransitionOn] = React.useState(true);

  // 자동 슬라이드 (4초마다, pause 시 멈춤)
  React.useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => {
      setIndex((prev) => prev + 1);
    }, 4000);
    return () => clearInterval(timer);
  }, [isPaused]);

  // 무한 루프: index가 3에 도달하면 transition 끄고 0으로 점프
  React.useEffect(() => {
    if (index === 3) {
      const timer = setTimeout(() => {
        setTransitionOn(false);
        setIndex(0);
      }, 550);
      return () => clearTimeout(timer);
    } else if (!transitionOn) {
      const timer = setTimeout(() => setTransitionOn(true), 50);
      return () => clearTimeout(timer);
    }
  }, [index, transitionOn]);

  // 스와이프 감지
  const minSwipeDistance = 50;
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
    setIsPaused(true); // 만지는 동안 자동 슬라이드 멈춤
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };
  const handleTouchEnd = () => {
    if (touchStart !== null && touchEnd !== null) {
      const distance = touchStart - touchEnd;
      if (distance > minSwipeDistance) {
        setIndex((prev) => (prev + 1) % 3);
      } else if (distance < -minSwipeDistance) {
        setIndex((prev) => (prev - 1 + 3) % 3);
      }
    }
    // 1초 후 자동 슬라이드 재개
    setTimeout(() => setIsPaused(false), 1000);
  };
  const noticeCard = (
    <div
      onClick={onUrgentClick}
      style={{
        minWidth: "100%",
        boxSizing: "border-box",
        background: "#FFF5F5",
        border: "1px solid #FED7D7",
        borderRadius: 12,
        padding: "12px 16px",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Icon
          path="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
          color="#EF4444"
          size={18}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#991B1B",
          }}
        >
          공지사항
        </span>
      </div>

      {carouselNotices.slice(0, 4).map((notice, idx) => {
        const isUrgent = notice.tag === "긴급";
        return (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 0",
            }}
          >
            <span
              style={{
                background: isUrgent ? "#EF4444" : "#4F46E5",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 4,
                padding: "2px 7px",
                whiteSpace: "nowrap",
              }}
            >
              {isUrgent ? "긴급" : "공지"}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 13,
                color: "#1F2937",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {notice.title}
            </span>
          </div>
        );
      })}
    </div>
  );
  return (
    <div style={{ marginBottom: 12 }}>
      {/* 캐러셀 컨테이너 */}
      <div
        style={{ overflow: "hidden", borderRadius: 12 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          style={{
            display: "flex",
            transform: `translateX(-${index * 100}%)`,
            transition: transitionOn ? "transform 0.5s ease" : "none",
          }}
        >
          {/* ===== 1번 카드: 공지 (긴급+일반, 최대 4개) ===== */}
          {noticeCard}

          {/* ====== 2번 카드: 접속포인트 TOP3 ====== */}
          <div
            style={{
              minWidth: "100%",
              boxSizing: "border-box",
              background: "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)",
              border: "1px solid #FCD34D",
              borderRadius: 12,
              padding: "12px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>🏆</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#92400E",
                }}
              >
                이번 달 활동 TOP 3
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  color: "#92400E",
                  opacity: 0.7,
                }}
              >
                매월 1일 리셋
              </span>
            </div>

            {topUsers.length === 0 ? (
              <div style={{ fontSize: 12, color: "#92400E", opacity: 0.7, padding: "4px 0" }}>
                아직 집계된 활동이 없어요
              </div>
            ) : (
              topUsers.map((u) => (
                <div
                  key={u.rank}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 0",
                    fontSize: 12,
                    color: "#78350F",
                  }}
                >
                  <span style={{ fontSize: 14 }}>
                    {u.rank === 1 ? "🥇" : u.rank === 2 ? "🥈" : "🥉"}
                  </span>
                  <span style={{ fontWeight: 600 }}>{u.rank}위</span>
                  <span style={{ flex: 1, fontWeight: u.isMe ? 800 : 500 }}>
                    {u.isMe ? "나" : `조합원 ${["A", "B", "C"][u.rank - 1]}`}
                  </span>
                  <span style={{ fontWeight: 700 }}>{u.total}P</span>
                </div>
              ))
            )}
            {myRank && myRank.rank > 3 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0 0",
                  marginTop: 4,
                  borderTop: "1px solid rgba(146,64,14,0.15)",
                  fontSize: 12,
                  color: "#78350F",
                  fontWeight: 700,
                }}
              >
                <span style={{ flex: 1 }}>내 순위</span>
                <span>{myRank.rank}위 ({myRank.total}P)</span>
              </div>
            )}
          </div>

          {/* ====== 3번 카드: 경조사 ====== */}
          <div
            onClick={onCondolenceClick}
            style={{
              minWidth: "100%",
              boxSizing: "border-box",
              background: "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)",
              border: "1px solid #C4B5FD",
              borderRadius: 12,
              padding: "12px 16px",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>💐</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#5B21B6",
                }}
              >
                조합원 경조사
              </span>
            </div>

            {condolences.length === 0 ? (
              <div style={{ fontSize: 12, color: "#6B7280", padding: "4px 0" }}>
                현재 경조사 안내가 없습니다
              </div>
            ) : (
              condolences.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 0",
                    fontSize: 12,
                    color: "#4C1D95",
                  }}
                >
                  <span
                    style={{
                      background: c.type === "결혼" ? "#EC4899" : "#6B7280",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 600,
                      borderRadius: 4,
                      padding: "1px 6px",
                    }}
                  >
                    {c.type}
                  </span>
                  <span style={{ flex: 1, fontWeight: 500 }}>
                    {c.name} 조합원
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{c.date}</span>
                </div>
              ))
            )}
          </div>

          {/* ====== 4번 카드: 긴급공지 복제본 (무한 루프용) ====== */}

          {noticeCard}
        </div>
      </div>
      {/* 점 인디케이터 */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 6,
          marginTop: 10,
        }}
      >
        {(() => {
          const realIndex = index % 3;
          return [0, 1, 2].map((i) => (
            <div
              key={i}
              onClick={() => {
                setIndex(i);
                setIsPaused(true);
                setTimeout(() => setIsPaused(false), 3000);
              }}
              style={{
                width: i === realIndex ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background: i === realIndex ? "#4F46E5" : "#D1D5DB",
                cursor: "pointer",
                transition: "width 0.3s ease, background 0.3s ease",
              }}
            />
          ));
        })()}
      </div>
    </div>
  );
}

// =====================================================
// 🎀 경조사 추가/수정 폼
// =====================================================
function EventForm({ event, eventTypes, onClose }) {
  const isEdit = !!event;
  const [memberName, setMemberName] = useState(event ? event.member_name : "");
  const [eventType, setEventType] = useState(event ? event.event_type : "결혼");
  const [eventDate, setEventDate] = useState(event ? event.event_date : "");
  const [location, setLocation] = useState(event ? event.location : "");
  const [note, setNote] = useState(event ? event.note : "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!memberName.trim()) {
      alert("조합원 이름을 입력해주세요.");
      return;
    }
    if (!eventDate) {
      alert("날짜를 선택해주세요.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        member_name: memberName.trim(),
        event_type: eventType,
        event_date: eventDate,
        location: location.trim(),
        note: note.trim(),
        is_active: true,
      };
      if (isEdit) {
        const { error } = await supabase
          .from("events")
          .update(payload)
          .eq("id", event.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("events").insert([payload]);
        if (error) throw error;
      }
      onClose(true);
    } catch (err) {
      console.error("저장 실패:", err);
      alert("저장에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 6,
  } as const;
  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    fontSize: 14,
    border: "1px solid #D1D5DB",
    borderRadius: 8,
    marginBottom: 16,
  } as const;

  return (
    <div style={{ padding: "20px 16px", maxWidth: 480, margin: "0 auto" }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
        {isEdit ? "경조사 수정" : "경조사 추가"}
      </h2>

      <label style={labelStyle}>조합원 이름</label>
      <input
        style={inputStyle}
        value={memberName}
        onChange={(e) => setMemberName(e.target.value)}
        placeholder="예: 홍길동"
      />

      <label style={labelStyle}>경조사 종류</label>
      <select
        style={inputStyle}
        value={eventType}
        onChange={(e) => setEventType(e.target.value)}
      >
        {eventTypes.map((t) => (
          <option key={t.value} value={t.value}>
            {t.value}
          </option>
        ))}
      </select>

      <label style={labelStyle}>날짜</label>
      <input
        type="date"
        style={inputStyle}
        value={eventDate}
        onChange={(e) => setEventDate(e.target.value)}
      />

      <label style={labelStyle}>장소</label>
      <input
        style={inputStyle}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="예: ○○병원 장례식장 3호실"
      />

      <label style={labelStyle}>메모 (선택)</label>
      <textarea
        style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="추가 안내사항"
      />

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button
          onClick={() => onClose(false)}
          style={{
            flex: 1,
            padding: "12px",
            fontSize: 15,
            fontWeight: 600,
            color: "#374151",
            background: "#F3F4F6",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          취소
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1,
            padding: "12px",
            fontSize: 15,
            fontWeight: 600,
            color: "#fff",
            background: saving ? "#9CA3AF" : "#4F46E5",
            border: "none",
            borderRadius: 8,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
// ============================================================
// 🎀 경조사 관리자 페이지
// ============================================================
function EventsAdminPage({ onBack }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [error, setError] = useState("");

  const eventTypes = [
    { value: "결혼", label: "💒 결혼", color: "#EC4899" },
    { value: "출산", label: "👶 출산", color: "#10B981" },
    { value: "부친상", label: "🕊️ 부친상", color: "#6B7280" },
    { value: "모친상", label: "🕊️ 모친상", color: "#6B7280" },
    { value: "조부상", label: "🕊️ 조부상", color: "#6B7280" },
    { value: "조모상", label: "🕊️ 조모상", color: "#6B7280" },
    { value: "회갑", label: "🎂 회갑", color: "#F59E0B" },
    { value: "칠순", label: "🎂 칠순", color: "#F59E0B" },
    { value: "기타", label: "📌 기타", color: "#8B5CF6" },
  ];

  const loadEvents = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("event_date", { ascending: false });
      if (error) throw error;
      setEvents(data || []);
    } catch (err) {
      console.error("경조사 불러오기 실패:", err);
      setError("데이터를 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`'${name}' 경조사를 삭제하시겠습니까?`)) return;
    try {
      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw error;
      alert("삭제되었습니다.");
      loadEvents();
    } catch (err) {
      console.error("삭제 실패:", err);
      alert("삭제에 실패했습니다.");
    }
  };

  const toggleActive = async (id, currentStatus) => {
    try {
      const { error } = await supabase
        .from("events")
        .update({ is_active: !currentStatus })
        .eq("id", id);
      if (error) throw error;
      loadEvents();
    } catch (err) {
      console.error("상태 변경 실패:", err);
      alert("상태 변경에 실패했습니다.");
    }
  };

  const handleEdit = (event) => {
    setEditingEvent(event);
    setShowForm(true);
  };

  const handleAdd = () => {
    setEditingEvent(null);
    setShowForm(true);
  };

  const handleFormClose = (refresh) => {
    setShowForm(false);
    setEditingEvent(null);
    if (refresh) loadEvents();
  };

  const getTypeColor = (type) => {
    const t = eventTypes.find((e) => e.value === type);
    return t ? t.color : "#8B5CF6";
  };

  const getTypeLabel = (type) => {
    const t = eventTypes.find((e) => e.value === type);
    return t ? t.label : `📌 ${type}`;
  };

  if (showForm) {
    return (
      <EventForm
        event={editingEvent}
        eventTypes={eventTypes}
        onClose={handleFormClose}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F9FAFB" }}>
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
          color: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>🎀 경조사 관리</div>
          <button
            onClick={handleAdd}
            style={{
              background: "#fff",
              border: "none",
              color: "#4F46E5",
              padding: "8px 14px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            + 추가
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
          홈 캐러셀에 표시될 조합원 경조사를 관리합니다
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>
            ⏳ 불러오는 중...
          </div>
        )}
        {error && (
          <div
            style={{
              background: "#FEE2E2",
              border: "1px solid #FECACA",
              borderRadius: 8,
              padding: 12,
              color: "#991B1B",
              marginBottom: 12,
              fontSize: 14,
            }}
          >
            ⚠️ {error}
          </div>
        )}
        {!loading && events.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: 60,
              color: "#6B7280",
              background: "#fff",
              borderRadius: 12,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎀</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              등록된 경조사가 없습니다
            </div>
            <div style={{ fontSize: 13, color: "#9CA3AF" }}>
              우측 상단 '+ 추가' 버튼을 눌러 등록하세요
            </div>
          </div>
        )}
        {!loading &&
          events.map((event) => (
            <div
              key={event.id}
              style={{
                background: "#fff",
                borderRadius: 12,
                padding: 16,
                marginBottom: 10,
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                border: event.is_active
                  ? "1px solid #E5E7EB"
                  : "1px dashed #D1D5DB",
                opacity: event.is_active ? 1 : 0.6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    background: getTypeColor(event.event_type) + "20",
                    color: getTypeColor(event.event_type),
                    padding: "4px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {getTypeLabel(event.event_type)}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: event.is_active ? "#10B981" : "#9CA3AF",
                    fontWeight: 600,
                  }}
                >
                  {event.is_active ? "● 표시중" : "○ 숨김"}
                </span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1F2937" }}>
                {event.member_name} 조합원
              </div>
              <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>
                📅 {event.event_date}
                {event.location && ` · 📍 ${event.location}`}
              </div>
              {event.note && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#9CA3AF",
                    marginTop: 6,
                    padding: 8,
                    background: "#F9FAFB",
                    borderRadius: 6,
                  }}
                >
                  💬 {event.note}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid #F3F4F6",
                }}
              >
                <button
                  onClick={() => toggleActive(event.id, event.is_active)}
                  style={{
                    flex: 1,
                    padding: 8,
                    background: event.is_active ? "#F3F4F6" : "#DBEAFE",
                    color: event.is_active ? "#6B7280" : "#1D4ED8",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {event.is_active ? "숨기기" : "표시하기"}
                </button>
                <button
                  onClick={() => handleEdit(event)}
                  style={{
                    flex: 1,
                    padding: 8,
                    background: "#EEF2FF",
                    color: "#4F46E5",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  ✏️ 수정
                </button>
                <button
                  onClick={() => handleDelete(event.id, event.member_name)}
                  style={{
                    flex: 1,
                    padding: 8,
                    background: "#FEE2E2",
                    color: "#DC2626",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  🗑️ 삭제
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
// ============================================================
// 🔔 공지 관리자 페이지 (notices 테이블)
// ============================================================
function NoticeAdminPage({ onBack }) {
  const [noticeList, setNoticeList] = useState([]);
  const [ldg, setLdg] = useState(true);
  const [showFm, setShowFm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [errMsg, setErrMsg] = useState("");

  const loadList = async () => {
    setLdg(true);
    setErrMsg("");
    try {
      const { data, error } = await supabase
        .from("notices")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setNoticeList(data || []);
    } catch (err) {
      console.error("공지 불러오기 실패:", err);
      setErrMsg("데이터를 불러올 수 없습니다.");
    } finally {
      setLdg(false);
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  const delItem = async (id, title) => {
    if (!window.confirm("'" + title + "' 공지를 삭제하시겠습니까?")) return;
    try {
      const { error } = await supabase.from("notices").delete().eq("id", id);
      if (error) throw error;
      alert("삭제되었습니다.");
      loadList();
    } catch (err) {
      alert("삭제 실패: " + err.message);
    }
  };

  const togActive = async (id, cur) => {
    try {
      const { error } = await supabase
        .from("notices")
        .update({ is_active: !cur })
        .eq("id", id);
      if (error) throw error;
      loadList();
    } catch (err) {
      alert("상태 변경 실패: " + err.message);
    }
  };

  if (showFm) {
    return (
      <NoticeForm
        item={editItem}
        onClose={(refresh) => {
          setShowFm(false);
          setEditItem(null);
          if (refresh) loadList();
        }}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F9FAFB" }}>
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "52px 20px 24px",
          borderRadius: 28,
          color: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
         <button
            onClick={onBack}
            style={{
              background: "rgba(255,255,255,0.15)",
              border: "none",
              borderRadius: "50%",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
          </button>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>🔔 공지 관리</div>
          <button
            onClick={() => {
              setEditItem(null);
              setShowFm(true);
            }}
            style={{
              background: "#fff",
              border: "none",
              color: "#4F46E5",
              padding: "8px 14px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            + 추가
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
          긴급공지(빨강)는 홈 캐러셀에, 일반공지는 공지사항 메뉴에 표시됩니다
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {ldg && (
          <div style={{ textAlign: "center", padding: 40, color: "#6B7280" }}>
            ⏳ 불러오는 중...
          </div>
        )}
        {errMsg && (
          <div
            style={{
              background: "#FEE2E2",
              border: "1px solid #FECACA",
              borderRadius: 8,
              padding: 12,
              color: "#991B1B",
              marginBottom: 12,
              fontSize: 14,
            }}
          >
            ⚠️ {errMsg}
          </div>
        )}
        {!ldg && noticeList.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: 60,
              color: "#6B7280",
              background: "#fff",
              borderRadius: 12,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔔</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              등록된 공지가 없습니다
            </div>
            <div style={{ fontSize: 13, color: "#9CA3AF" }}>
              우측 상단 '+ 추가' 버튼을 눌러 등록하세요
            </div>
          </div>
        )}
        {!ldg &&
          noticeList.map((n) => {
            const urgent = n.tag === "긴급";
            return (
              <div
                key={n.id}
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 10,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  border: n.is_active
                    ? urgent
                      ? "1px solid #FECACA"
                      : "1px solid #E5E7EB"
                    : "1px dashed #D1D5DB",
                  opacity: n.is_active ? 1 : 0.6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      background: urgent ? "#FEE2E2" : "#EEF2FF",
                      color: urgent ? "#DC2626" : "#4F46E5",
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {urgent ? "🚨 긴급" : "📢 공지"}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: n.is_active ? "#10B981" : "#9CA3AF",
                      fontWeight: 600,
                    }}
                  >
                    {n.is_active ? "● 표시중" : "○ 숨김"}
                  </span>
                </div>
                <div
                  style={{ fontSize: 16, fontWeight: 700, color: "#1F2937" }}
                >
                  {n.title}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "#6B7280",
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  {n.content}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: "1px solid #F3F4F6",
                  }}
                >
                  <button
                    onClick={() => togActive(n.id, n.is_active)}
                    style={{
                      flex: 1,
                      padding: 8,
                      background: n.is_active ? "#F3F4F6" : "#DBEAFE",
                      color: n.is_active ? "#6B7280" : "#1D4ED8",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {n.is_active ? "숨기기" : "표시하기"}
                  </button>
                  <button
                    onClick={() => {
                      setEditItem(n);
                      setShowFm(true);
                    }}
                    style={{
                      flex: 1,
                      padding: 8,
                      background: "#EEF2FF",
                      color: "#4F46E5",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ✏️ 수정
                  </button>
                  <button
                    onClick={() => delItem(n.id, n.title)}
                    style={{
                      flex: 1,
                      padding: 8,
                      background: "#FEE2E2",
                      color: "#DC2626",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    🗑️ 삭제
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
// ============================================================
// 입력 폼: 공지 추가/수정 (notices 테이블)
// ============================================================
function NoticeForm({ item, onClose }) {
  const isEdit = !!item;
  const [ttl, setTtl] = useState(item?.title || "");
  const [cnt, setCnt] = useState(item?.content || "");
  const [tg, setTg] = useState(item?.tag || "공지");
  const [act, setAct] = useState(
    item?.is_active !== undefined ? item.is_active : true
  );
  const [svg, setSvg] = useState(false);

  const doSave = async () => {
    if (!ttl.trim()) {
      alert("제목을 입력해주세요.");
      return;
    }
    if (!cnt.trim()) {
      alert("내용을 입력해주세요.");
      return;
    }
    setSvg(true);
    try {
      const payload = {
        title: ttl.trim(),
        content: cnt.trim(),
        tag: tg,
        is_active: act,
        color: tg === "긴급" ? "red" : "indigo",
      };
      if (isEdit) {
        const { error } = await supabase
          .from("notices")
          .update(payload)
          .eq("id", item.id);
        if (error) throw error;
        alert("수정되었습니다.");
      } else {
        const { error } = await supabase.from("notices").insert([payload]);
        if (error) throw error;
        alert("등록되었습니다.");
      }
      onClose(true);
    } catch (err) {
      console.error("저장 실패:", err);
      alert("저장에 실패했습니다.\n" + err.message);
    } finally {
      setSvg(false);
    }
  };

  const lbl = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 6,
  } as const;
  const inp = {
    width: "100%",
    padding: "12px 14px",
    border: "1px solid #E5E7EB",
    borderRadius: 8,
    fontSize: 14,
    background: "#fff",
    boxSizing: "border-box",
    outline: "none",
  } as const;

  return (
    <div style={{ minHeight: "100vh", background: "#F9FAFB" }}>
      <div
        style={{
          background: "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)",
          padding: "20px 16px",
          color: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={() => onClose(false)}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              color: "#fff",
              padding: "8px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            취소
          </button>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {isEdit ? "✏️ 공지 수정" : "+ 공지 추가"}
          </div>
          <button
            onClick={doSave}
            disabled={svg}
            style={{
              background: "#fff",
              border: "none",
              color: "#4F46E5",
              padding: "8px 14px",
              borderRadius: 8,
              cursor: svg ? "wait" : "pointer",
              fontSize: 14,
              fontWeight: 600,
              opacity: svg ? 0.6 : 1,
            }}
          >
            {svg ? "저장 중..." : "💾 저장"}
          </button>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>분류 *</label>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <button
              onClick={() => setTg("긴급")}
              style={{
                padding: "14px 8px",
                background: tg === "긴급" ? "#DC2626" : "#fff",
                color: tg === "긴급" ? "#fff" : "#374151",
                border:
                  tg === "긴급" ? "2px solid #DC2626" : "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🚨 긴급공지
            </button>
            <button
              onClick={() => setTg("공지")}
              style={{
                padding: "14px 8px",
                background: tg === "공지" ? "#4F46E5" : "#fff",
                color: tg === "공지" ? "#fff" : "#374151",
                border:
                  tg === "공지" ? "2px solid #4F46E5" : "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              📢 일반공지
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 6 }}>
            {tg === "긴급"
              ? "홈 캐러셀 1번 카드(빨강)에 표시됩니다"
              : "공지사항 메뉴에 표시됩니다"}
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>제목 *</label>
          <input
            type="text"
            value={ttl}
            onChange={(e) => setTtl(e.target.value)}
            placeholder="예: 5월 노사협의 결과 안내"
            style={inp}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>내용 *</label>
          <textarea
            value={cnt}
            onChange={(e) => setCnt(e.target.value)}
            placeholder="공지 내용을 입력하세요"
            rows={6}
            style={{ ...inp, resize: "vertical", fontFamily: "inherit" }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>표시 여부</label>
          <div
            onClick={() => setAct(!act)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 14,
              background: "#fff",
              border: "1px solid #E5E7EB",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>
                {act ? "✅ 표시함" : "⭕ 숨김"}
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                {act ? "조합원들에게 표시됩니다" : "표시되지 않습니다"}
              </div>
            </div>
            <div
              style={{
                width: 44,
                height: 24,
                background: act ? "#4F46E5" : "#D1D5DB",
                borderRadius: 12,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: act ? 22 : 2,
                  width: 20,
                  height: 20,
                  background: "#fff",
                  borderRadius: "50%",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
// ── 메인 앱 ──
function BottomTabBar({ screen, setScreen }: { screen: string; setScreen: (s: string) => void }) {
  const tabs = [
    { icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6", label: "홈", action: "home" },
    { icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z", label: "공지", action: "noticeList" },
    { icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z", label: "근무표", action: "schedule" },
    { icon: "", emoji: "₩", label: "급여계산", action: "salary" },
    { icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z", label: "마이페이지", action: "mySettings" },
  ];
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 430,
        background: "#fff",
        borderTop: "1px solid #F3F4F6",
        display: "flex",
        padding: "10px 0 24px",
        zIndex: 100,
      }}
    >
      {tabs.map((tab, i) => {
        const active = screen === tab.action || (tab.action === "home" && screen === "home");
        return (
          <button
            key={i}
            onClick={() => setScreen(tab.action)}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              cursor: "pointer",
            }}
          >
            {tab.emoji ? (
              <span style={{ fontSize: 18, fontWeight: 900, color: active ? "#4F46E5" : "#9CA3AF" }}>
                {tab.emoji}
              </span>
            ) : (
              <Icon path={tab.icon} color={active ? "#4F46E5" : "#9CA3AF"} size={22} />
            )}
            <span style={{ fontSize: 10, color: active ? "#4F46E5" : "#9CA3AF", fontWeight: active ? 700 : 400 }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
export default function App() {
  const [screen, setScreen] = useState("login");
  const [user, setUser] = useState(null);
  const [autoLoginChecked, setAutoLoginChecked] = useState(false);
  const [notices, setNotices] = useState([]);
  const [boardTab, setBoardTab] = useState("전체");
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [selectedInquiry, setSelectedInquiry] = useState(null);
  const [aboutInitialTab, setAboutInitialTab] = useState("intro");
  const [showOnlineModal, setShowOnlineModal] = useState(false);
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [adjustCount, setAdjustCount] = useState(0);
 const [lastDate, setLastDate] = useState("");

  const [homeRotation, setHomeRotation] = useState<any[]>([]);
  const [homeDia, setHomeDia] = useState<any[]>([]);
  const [homeHolidays, setHomeHolidays] = useState<string[]>([]);
  const [homeSalaryData, setHomeSalaryData] = useState<any>(null);
  useEffect(() => {
    const loadHomeWork = async () => {
      const { data: rot } = await supabase
        .from("schedule_rotation")
        .select("*")
        .in("group_name", ["대공원 114", "도봉 41"])
        .order("position");
      if (rot) setHomeRotation(rot);

      const { data: dia } = await supabase.from("kyobun_dia").select("*");
      if (dia) setHomeDia(dia);

      try {
        const res = await fetch(
          "/.netlify/functions/read-holidays?year=" + new Date().getFullYear()
        );
        const json = await res.json();
        if (json.holidays) setHomeHolidays(json.holidays);
      } catch (e) {
        console.log("공휴일 불러오기 실패", e);
      }
      const emp = user?.employee_number;
      console.log("로딩 시작, emp:", emp);
      const now = new Date();
      const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastPrev = new Date(firstThis.getTime() - 86400000);
      const py = lastPrev.getFullYear();
      const mm = String(lastPrev.getMonth() + 1).padStart(2, "0");
      const endDay = new Date(py, lastPrev.getMonth() + 1, 0).getDate();
      const ty = now.getFullYear();
      const tm = String(now.getMonth() + 1).padStart(2, "0");
      const tEnd = new Date(ty, now.getMonth() + 1, 0).getDate();
      const [salaryRes, wtRes, meRes, hfRes, settingsRes, dedRes] = await Promise.all([
        supabase.from("salary_table").select("*").order("hobong", { ascending: true }),
        supabase.from("worktype_pay_settings").select("*"),
        emp ? supabase.from("members").select("grade, pay_step, start_position, schedule_total, work_group, work_type").eq("employee_number", emp).maybeSingle() : Promise.resolve({ data: null }),
        emp ? supabase.from("work_adjust").select("*").eq("employee_number", emp).eq("adjust_type", "holiday_fill").gte("work_date", `${ty}-${tm}-01`).lte("work_date", `${ty}-${tm}-${String(tEnd).padStart(2, "0")}`) : Promise.resolve({ data: null }),
        emp ? supabase.from("salary_settings").select("*").eq("employee_number", emp).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("deduction_rates").select("*").order("year", { ascending: false }).limit(1).maybeSingle(),
      ]);
      console.log("홈 쿼리 결과:", { salaryRes, meRes, dedRes });
      setHomeSalaryData({
        salaryTable: salaryRes.data || [],
        worktypeSettings: wtRes.data || [],
        memberInfo: meRes.data || null,
        hfRecords: hfRes.data || [],
        settings: settingsRes.data || null,
        dedRates: dedRes.data || null,
      });
    };
    loadHomeWork();
  }, []);
  const onlineList = dummyMembers.slice(0, 8);
  const usage7days = [
    { date: "5/13", count: 8 },
    { date: "5/14", count: 11 },
    { date: "5/15", count: 9 },
    { date: "5/16", count: 14 },
    { date: "5/17", count: 12 },
    { date: "5/18", count: 15 },
    { date: "5/19", count: 18 },
  ];

  // 앱 시작 시 자동로그인 체크
  useEffect(() => {
    try {
      const saved = localStorage.getItem("union_user");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          parsed &&
          parsed.status !== "blocked" &&
          parsed.status !== "kicked"
        ) {
          setUser(parsed);
          setScreen("home");
        } else {
          localStorage.removeItem("union_user");
        }
      }
    } catch (e) {}
    setAutoLoginChecked(true);
  }, []);

  // 전역 user 정보를 DB에서 새로 가져와서 갱신
  // 홈 카드용: 이번 달 근무조정 기록 수 + 승인대기 수 세오기
  useEffect(() => {
    if (!user?.employee_number) return;

    const fetchCounts = async () => {
      // 이번 달 1일 ~ 말일 범위 구하기
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const firstDay = new Date(y, m, 1).toISOString().split("T")[0];
      const lastDay = new Date(y, m + 1, 0).toISOString().split("T")[0];

      // 이번 달 work_adjust 기록 수
      const { count: adjCount } = await supabase
        .from("work_adjust")
        .select("*", { count: "exact", head: true })
        .eq("employee_number", user.employee_number)
        .gte("work_date", firstDay)
        .lte("work_date", lastDay);
      setAdjustCount(adjCount || 0);

      // 가장 최근 기록 날짜
      const { data: lastRec } = await supabase
        .from("work_adjust")
        .select("work_date")
        .eq("employee_number", user.employee_number)
        .order("work_date", { ascending: false })
        .limit(1);
      if (lastRec && lastRec.length > 0) {
        setLastDate(lastRec[0].work_date);
      } else {
        setLastDate("");
      }
    };

    fetchCounts();
  }, [user, screen]);
  const refreshUser = React.useCallback(async () => {
    if (!user?.employee_number) return;
    try {
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .eq("employee_number", user.employee_number)
        .maybeSingle();
      if (error) {
        console.log("refreshUser 실패:", error);
        return;
      }
      if (data) {
        console.log("refreshUser 성공:", data);
        setUser(data);
        // localStorage도 같이 갱신
        localStorage.setItem("union_user", JSON.stringify(data));
      }
    } catch (e) {
      console.log("refreshUser 예외:", e);
    }
  }, [user?.employee_number]);
 // 공지사항 불러오기 (notices 테이블)
  const loadNotices = async () => {
    const { data } = await supabase
      .from("notices")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    setNotices(data || []);
  };
  React.useEffect(() => {
    loadNotices();
  }, []);
  // 앱 접속 포인트
  React.useEffect(() => {
    if (user) addPoint(getUserId(user), "access");
  }, [user]);

  // 화면별 포인트 적립
  React.useEffect(() => {
    if (!user || user.is_admin) return;
    const uid = getUserId(user);
    if (screen === "noticeDetail" && selectedNotice) {
      addPoint(uid, "notice", selectedNotice.id || selectedNotice.title);
    }
    if (screen === "vote") addPoint(uid, "vote");
    if (screen === "workAdjust") addPoint(uid, "schedule");
  }, [screen, selectedNotice]);

  // 알림 차단 설정 (일반 조합원용)
  const [notifSettings, setNotifSettings] = useState({
    urgentNotice: true,
    agreement: true,
    board: false,
    inquiry: false,
    vote: false,
    anonymous: false,
  });
// 로그인하면 저장된 알림 설정 불러오기
  useEffect(() => {
    if (user?.notif_settings) {
      setNotifSettings((prev) => ({ ...prev, ...user.notif_settings }));
    }
  }, [user]);
  // 알림 설정이 바뀌면 자동 저장
  useEffect(() => {
    if (user?.employee_number) {
      supabase
        .from("members")
        .update({ notif_settings: notifSettings })
        .eq("employee_number", user.employee_number)
        .then(() => {});
    }
  }, [notifSettings]);
  // 1:1문의 미답변 건수 (status가 대기중인 것)
  const [pendingInquiryCount, setPendingInquiryCount] = useState(0);
const [unreadPostCount, setUnreadPostCount] = useState(0);
const [unreadReportCount, setUnreadReportCount] = useState(0);
  const [activeVote, setActiveVote] = useState(null);
  const [myNotifCount, setMyNotifCount] = useState(0);
  useEffect(() => {
    supabase
      .from("votes")
      .select("*")
      .eq("status", "진행중")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        setActiveVote(data && data[0] ? data[0] : null);
      });
  }, []);
  useEffect(() => {
    if (!user?.employee_number) return;
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_emp", user.employee_number)
      .eq("is_read", false)
      .then(({ count }) => {
        if (count !== null) setMyNotifCount(count);
      });
  }, [screen, user]);
  useEffect(() => {
    supabase
      .from("anonymous_reports")
      .select("id", { count: "exact", head: true })
      .eq("admin_read", false)
      .then(({ count }) => {
        if (count !== null) setUnreadReportCount(count);
      });
  }, [screen]);
  useEffect(() => {
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("admin_read", false)
      .then(({ count }) => {
        if (count !== null) setUnreadPostCount(count);
      });
  }, [screen]);
  useEffect(() => {
    supabase
      .from("inquiries")
      .select("id", { count: "exact", head: true })
      .eq("status", "대기중")
      .then(({ count }) => {
        if (count !== null) setPendingInquiryCount(count);
      });
  }, [screen]);
  // 알림 데이터 (관리자/일반 분리)
  const adminAlerts = [
    {
      id: 1,
      type: "anonymous",
      label: "익명제보",
      icon: "M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z",
      color: "#EF4444",
      count: unreadReportCount,
      screen: "anonymous",
    },
    {
      id: 2,
      type: "board",
      label: "자유게시판",
      icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
      color: "#4F46E5",
      count: unreadPostCount,
      screen: "board",
    },
    {
      id: 3,
      type: "notice",
      label: "공지사항",
      icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
      color: "#0EA5E9",
      count: 0,
      screen: "noticeList",
    },
    {
      id: 4,
      type: "vote",
      label: "설문·투표",
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
      color: "#F59E0B",
      count: 0,
      screen: "vote",
    },
    {
      id: 5,
      type: "inquiry",
      label: "1:1문의",
      icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      color: "#10B981",
      count: pendingInquiryCount,
      screen: "inquiry",
    },
  ];

  // 호봉 승급 알림 동적 생성
  // 알림 읽음 상태 관리 (사용자별 - localStorage + 메모리 이중 저장)
  const alertKey = `readAlerts_${getUserId(user)}`;
  const [readAlerts, setReadAlerts] = React.useState({});

  // user 변경 시 해당 사용자의 읽음 상태 로드
  React.useEffect(() => {
    try {
      const key = `readAlerts_${getUserId(user)}`;
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      setReadAlerts(saved);
    } catch (e) {
      setReadAlerts({});
    }
  }, [user]);

  const markAlertRead = (alertId) => {
    const updated = { ...readAlerts, [alertId]: true };
    setReadAlerts(updated); // 메모리에 즉시 반영
    try {
      localStorage.setItem(alertKey, JSON.stringify(updated));
    } catch (e) {}
    try {
      sessionStorage.setItem(alertKey, JSON.stringify(updated));
    } catch (e) {}
  };

  // sessionStorage 백업에서도 로드 시도
  React.useEffect(() => {
    try {
      const key = `readAlerts_${getUserId(user)}`;
      const fromLocal = JSON.parse(localStorage.getItem(key) || "{}");
      const fromSession = JSON.parse(sessionStorage.getItem(key) || "{}");
      // 두 저장소 병합 (읽은 것은 유지)
      const merged = { ...fromLocal, ...fromSession };
      setReadAlerts(merged);
    } catch (e) {
      setReadAlerts({});
    }
  }, [user]);

  const getAlertCount = (id, baseCount) => (readAlerts[id] ? 0 : baseCount);

  const promoAlertForList = user?.join_date
    ? checkPromoAlert(user.join_date, parseInt(user?.add_pay_step || "0") || 0)
    : null;

  const userAlerts = [
    ...(promoAlertForList
      ? [
          {
            id: 0,
            type: "promo",
            label: "호봉 승급 알림 🎉",
            icon: "M12 8v13m0-13V6a4 4 0 00-4-4H5.45a4 4 0 00-3.95 3.4L1 9m11-1h7M1 9h7m0 0l2-4m-2 4l2 4",
            color: "#f59e0b",
            count: 1,
            screen: "mySettings",
            desc: `${promoAlertForList.promoDate} · ${promoAlertForList.nextPayStep}호봉 승급 예정`,
          },
        ]
      : []),
    {
      id: 1,
      type: "urgentNotice",
      label: "긴급공지",
      icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
      color: "#EF4444",
      count: getAlertCount(1, 1),
      screen: "noticeList",
    },
    {
      id: 2,
      type: "agreement",
      label: "단협규정",
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
      color: "#4F46E5",
      count: getAlertCount(2, 0),
      screen: "archive",
    },
    {
      id: 3,
      type: "board",
      label: "자유게시판",
      icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
      color: "#0EA5E9",
      count: myNotifCount,
      screen: "board",
    },
    {
      id: 4,
      type: "vote",
      label: "설문·투표",
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
      color: "#F59E0B",
      count: getAlertCount(4, 0),
      screen: "vote",
    },
    {
      id: 5,
      type: "inquiry",
      label: "1:1문의",
      icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      color: "#10B981",
      count: getAlertCount(5, 0),
      screen: "inquiry",
    },
  ];

  const currentAlerts = user?.is_admin
    ? adminAlerts
    : userAlerts.filter(
        (a) =>
          a.type === "promo" ||
          notifSettings[a.type as keyof typeof notifSettings]
      );
  const totalAlertCount = (currentAlerts as any[]).reduce((s, a) => s + a.count, 0);

  const [promoAlert, setPromoAlert] = useState(null);
  const [memberCount, setMemberCount] = useState(0);
  const [appUserCount, setAppUserCount] = useState(0);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);
  useEffect(() => {
    supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("is_union", true)
      .then(({ count }) => {
        if (count !== null) setMemberCount(count);
      });
    supabase
      .from("members")
      .select("*", { count: "exact", head: true })
      .eq("is_app_user", true)
      .then(({ count }) => {
        if (count !== null) setAppUserCount(count);
      });
  }, []);
  // 호봉 승급 알림 체크 (로그인 시 & 홈 진입 시)
  useEffect(() => {
    if (user?.join_date && screen === "home") {
      const addNum = parseInt(user?.add_pay_step || "0") || 0;
      const alert = checkPromoAlert(user.join_date, addNum);
      if (alert) setPromoAlert(alert);
    }
  }, [user, screen]);

  const displayNotices = notices.map((n) => ({
    ...n,
    tag: n.tag,
    tagColor: n.tag === "긴급" ? "#EF4444" : "#4F46E5",
    tagBg: n.tag === "긴급" ? "#FEE2E2" : "#EEF0FF",
    date: n.created_at?.slice(0, 10),
  }));

  const urgentNotice = displayNotices.find((n) => n.tag === "긴급");
  const carouselNotices = [...displayNotices]
    .sort((a, b) => {
      if (a.tag === "긴급" && b.tag !== "긴급") return -1;
      if (a.tag !== "긴급" && b.tag === "긴급") return 1;
      return 0;
    })
    .slice(0, 4);
  // 자동로그인 체크 전 빈 화면
  if (!autoLoginChecked) {
    return (
      <div
        style={{
          maxWidth: 430,
          margin: "0 auto",
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <EmblemImg
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: "3px solid rgba(255,255,255,0.5)",
            objectFit: "cover",
            marginBottom: 16,
          }}
        />
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "#fff",
            marginBottom: 8,
          }}
        >
          대공원승무지회
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
          잠시만 기다려주세요...
        </div>
      </div>
    );
  }

  if (screen === "login")
    return (
      <LoginScreen
        onLogin={(u) => {
          localStorage.setItem("union_user", JSON.stringify({ ...u }));
          setUser(u);
          setScreen("home");
        }}
        onGoRegister={() => setScreen("register")}
      />
    );
  if (screen === "register")
    return <RegisterScreen onBack={() => setScreen("login")} />;
  if (screen === "noticeDetail" && selectedNotice)
    return (
      <div style={{ padding: "calc(env(safe-area-inset-top) + 24px) 16px 40px", maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#fff" }}>
        <button
          onClick={() => setScreen("noticeList")}
          style={{ marginBottom: 16, padding: "8px 16px", borderRadius: 8, border: "1px solid #E5E7EB", background: "#fff", cursor: "pointer", fontFamily: "inherit" }}
        >
          ← 목록으로
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          {(selectedNotice as any)?.title || "공지"}
        </h2>
        <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {(selectedNotice as any)?.content || "내용 준비 중입니다."}
        </div>
      </div>
    );
  if (screen === "noticeList")
    return (
      <>
        <NoticeList
          notices={displayNotices}
          onBack={() => setScreen("home")}
          onSelect={(n) => {
            setSelectedNotice(n);
            setScreen("noticeDetail");
          }}
        />
        <BottomTabBar screen={screen} setScreen={setScreen} />
      </>
    );
  if (screen === "canteen")
        return <CanteenScreen onBack={() => setScreen("home")} user={user} />;
  if (screen === "board")
    return (
      <BoardList
        onBack={() => setScreen("home")}
        initialFilter={boardTab}
        onSelect={(p) => {
          setSelectedPost(p);
          setScreen("boardDetail");
        }}
        onWrite={() => setScreen("boardWrite")}
        user={user}
      />
    );
  if (screen === "boardDetail" && selectedPost)
    return (
      <BoardDetail
        post={selectedPost}
        onBack={() => setScreen("board")}
        user={user}
      />
    );
  if (screen === "boardWrite")
    return (
      <BoardWrite
        onBack={() => setScreen("board")}
        user={user}
        onSubmit={(post) => {
          const newPost = {
            title: post.title,
            content: post.content,
            category: post.category,
            author: user?.name,
            author_emp: user?.employee_number,
            is_anonymous: false,
            views: 0,
          };
          supabase
            .from("posts")
            .insert([newPost])
            .select()
            .then(({ data }) => {
              if (data && data[0]) {
                setSelectedPost({ ...data[0], comments: [] });
                setScreen("boardDetail");
              } else {
                setScreen("board");
              }
            });
        }}
      />
    );
  if (screen === "inquiry")
    return (
      <InquiryList
        onBack={() => setScreen("home")}
        onSelect={(inq) => {
          setSelectedInquiry(inq);
          setScreen("inquiryDetail");
        }}
        onWrite={() => setScreen("inquiryWrite")}
        user={user}
      />
    );
  if (screen === "inquiryDetail" && selectedInquiry)
    return (
      <InquiryDetail
        inquiry={selectedInquiry}
        onBack={() => setScreen("inquiry")}
        user={user}
      />
    );
  if (screen === "inquiryWrite")
    return (
      <InquiryWrite
        onBack={() => setScreen("inquiry")}
        user={user}
        onSubmit={(inq) => {
          const newInq = {
            author: user?.name,
            author_emp_id: String(user?.emp_id || user?.id || "guest"),
            title: inq.title,
            content: inq.content,
            status: "대기중",
          };
          supabase
            .from("inquiries")
            .insert([newInq])
            .select()
            .then(({ data }) => {
              if (data && data[0]) {
                setSelectedInquiry(data[0]);
                setScreen("inquiryDetail");
              } else {
                setScreen("inquiry");
              }
            });
        }}
      />
    );
  if (screen === "welfare")
    return <WelfareScreen onBack={() => setScreen("home")} user={user} />;
  if (screen === "vote")
    return <VoteScreen onBack={() => setScreen("home")} user={user} />;
  if (screen === "anonymous")
    return (
      <AnonymousReportList
        onBack={() => setScreen("home")}
        onWrite={() => setScreen("anonymousWrite")}
        user={user}
      />
    );
  if (screen === "anonymousWrite")
    return (
      <AnonymousReportWrite
        onBack={() => setScreen("anonymous")}
        onSubmit={() => setScreen("anonymous")}
      />
    );
  if (screen === "archive")
    return <ArchiveScreen onBack={() => setScreen("home")} user={user} />;
  if (screen === "about")
    return (
      <AboutScreen
        onBack={() => setScreen("home")}
        initialTab={aboutInitialTab}
        user={user}
      />
    );
  if (screen === "admin")
    return (
      <AdminScreen
        onBack={() => setScreen("home")}
        onNavigate={(t) => setScreen(t)}
        user={user}
      />
    );
  if (screen === "events-admin")
    return <EventsAdminPage onBack={() => setScreen("home")} />;
  if (screen === "notice-admin")
    return <NoticeAdminPage onBack={() => { loadNotices(); setScreen("home"); }} />;
  if (screen === "workAdjust")
    return <WorkAdjustScreen onBack={() => setScreen("home")} user={user} />;

  if (screen === "salary")
    return (
      <>
        <SalaryScreen onBack={() => setScreen("home")} user={user} />
        <BottomTabBar screen={screen} setScreen={setScreen} />
      </>
    );
  if (screen === "leave")
    return <LeaveScreen onBack={() => setScreen("home")} user={user} />;

  if (screen === "logbook")
    return <LogbookScreen goBack={() => setScreen("home")} />;
  if (screen === "schedule")
    return (
      <>
        <ScheduleScreen
          onBack={() => setScreen("home")}
          user={user}
          refreshUser={refreshUser}
        />
        <BottomTabBar screen={screen} setScreen={setScreen} />
      </>
    );
  if (screen === "mySettings")
    return (
      <>
        <MySettingsScreen
          onBack={() => setScreen("home")}
          user={user}
          refreshUser={refreshUser}
          notifSettings={notifSettings}
          setNotifSettings={setNotifSettings}
          onLogout={() => {
            localStorage.removeItem("union_user");

            setUser(null);
            setScreen("login");
          }}
        />
        <BottomTabBar screen={screen} setScreen={setScreen} />
      </>
    );
  if (screen === "notifications")
    return (
      <div
        style={{
          maxWidth: 430,
          margin: "0 auto",
          fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
          background: "#F4F3FF",
          minHeight: "100vh",
          paddingBottom: 80,
        }}
      >
        <div
          style={{
            background:
              "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
            padding: "52px 20px 24px",
          borderRadius: 28,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => setScreen("home")}
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "none",
                borderRadius: "50%",
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Icon path="M15 19l-7-7 7-7" color="#fff" size={20} />
            </button>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>
                대공원승무지회
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>
                알림
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.7)",
                  marginTop: 4,
                }}
              >
                {user?.is_admin
                  ? "관리자 알림 · 전체 항목"
                  : "내 알림 · 차단 설정 가능"}
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "12px 16px 0" }}>
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
              marginBottom: 12,
            }}
          >
            {currentAlerts.map((alert, i) => {
              const isUnread = alert.count > 0;
              return (
                <div
                  key={alert.id}
                  onClick={() => {
                    markAlertRead(alert.id);
                    setScreen(alert.screen);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "16px 20px",
                    borderBottom:
                      i < currentAlerts.length - 1
                        ? "1px solid #F3F4F6"
                        : "none",
                    cursor: "pointer",
                    background:
                      alert.type === "promo"
                        ? "#fffbeb"
                        : isUnread
                        ? "#F8F7FF"
                        : "#fff",
                    borderLeft: isUnread
                      ? "4px solid #4F46E5"
                      : "4px solid transparent",
                    transition: "all 0.2s",
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: isUnread
                        ? `${alert.color}25`
                        : `${alert.color}12`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      position: "relative",
                    }}
                  >
                    {alert.type === "promo" ? (
                      <span style={{ fontSize: 22 }}>🎉</span>
                    ) : (
                      <Icon
                        path={alert.icon}
                        color={isUnread ? alert.color : "#9CA3AF"}
                        size={22}
                      />
                    )}
                    {isUnread && (
                      <div
                        style={{
                          position: "absolute",
                          top: -4,
                          right: -4,
                          background: "#EF4444",
                          color: "#fff",
                          fontSize: 9,
                          fontWeight: 700,
                          borderRadius: "50%",
                          width: 16,
                          height: 16,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {alert.count}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: isUnread ? 800 : 500,
                        color:
                          alert.type === "promo"
                            ? "#92400e"
                            : isUnread
                            ? "#1F2937"
                            : "#9CA3AF",
                      }}
                    >
                      {alert.label}
                      {isUnread && (
                        <span
                          style={{
                            marginLeft: 6,
                            background: "#EF4444",
                            color: "#fff",
                            fontSize: 9,
                            fontWeight: 700,
                            borderRadius: 6,
                            padding: "2px 6px",
                          }}
                        >
                          NEW
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: isUnread ? "#6B7280" : "#9CA3AF",
                        marginTop: 2,
                      }}
                    >
                      {alert.type === "promo" && alert.desc
                        ? alert.desc
                        : isUnread
                        ? `새 알림 ${alert.count}건 · 탭하여 확인`
                        : "읽음"}
                    </div>
                  </div>
                  <Icon
                    path="M9 5l7 7-7 7"
                    color={isUnread ? "#4F46E5" : "#E5E7EB"}
                    size={18}
                  />
                </div>
              );
            })}
          </div>
          {!user?.is_admin && (
            <div
              style={{
                background: "#fff",
                borderRadius: 20,
                padding: "20px",
                boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#1F2937",
                  marginBottom: 4,
                }}
              >
                알림 설정
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 16 }}>
                받고 싶은 알림만 선택하세요
              </div>
              {[
                {
                  key: "urgentNotice",
                  label: "긴급공지",
                  desc: "긴급 공지사항 알림",
                  locked: true,
                },
                {
                  key: "agreement",
                  label: "단협규정",
                  desc: "단협 변경 알림",
                  locked: true,
                },
                {
                  key: "board",
                  label: "자유게시판",
                  desc: "새 글 및 댓글 알림",
                },
                { key: "vote", label: "설문·투표", desc: "새 투표 알림" },
                { key: "inquiry", label: "1:1문의", desc: "답변 알림" },
              ].map((item, i, arr) => (
                <div
                  key={item.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 0",
                    borderBottom:
                      i < arr.length - 1 ? "1px solid #F3F4F6" : "none",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#1F2937",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {item.label}
                      {item.locked && (
                        <span style={{ fontSize: 10, color: "#9CA3AF" }}>
                          🔒 필수
                        </span>
                      )}
                    </div>
                    <div
                      style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}
                    >
                      {item.desc}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (item.locked) return;
                      setNotifSettings((prev) => ({
                        ...prev,
                        [item.key]: !prev[item.key as keyof typeof prev],
                      }));
                    }}
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      border: "none",
                      cursor: item.locked ? "not-allowed" : "pointer",
                      background: notifSettings[
                        item.key as keyof typeof notifSettings
                      ]
                        ? "#4F46E5"
                        : "#E5E7EB",
                      position: "relative",
                      transition: "background 0.2s",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "#fff",
                        position: "absolute",
                        top: 3,
                        left: notifSettings[
                          item.key as keyof typeof notifSettings
                        ]
                          ? 23
                          : 3,
                        transition: "left 0.2s",
                      }}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );

  const newMenus = [
    {
      id: "schedule",
      label: "근무표",
      sub: "내 근무 확인",
      icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    },
    {
      id: "salary",
      label: "급여·수당",
      sub: "예상 급여 확인",
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      emoji: "₩",
    },
    {
      id: "leave",
      label: "연차·기타휴가",
      sub: "내 권리 계산",
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    },
    {
      id: "agreement",
      label: "단협규정",
      sub: "단협변경",
      icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    },
    {
      id: "anonymous",
      label: "익명 제보",
      sub: "익명으로 제보",
      icon: "M6 3v18M12 3v18M18 3v18M6 8c1.5 0 3-1 3-2.5M6 13c2 0 3.5-1 3.5-2.5M12 7c1.5 0 3-1 3-2.5M12 12c2 0 3.5-1 3.5-2.5M18 9c-1.5 0-3-1-3-2.5M18 14c-2 0-3.5-1-3.5-2.5",
    },
    {
      id: "board",
      label: "자유게시판",
      sub: "조합원과 소통",
      icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
    },
    {
      id: "notice",
      label: "공지사항",
      sub: "새로운 소식",
      icon: "M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z",
    },
    {
      id: "archive",
      label: "자료실",
      sub: "합의서·사규",
      icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
    },
    {
      id: "welfare",
      label: "복지혜택",
      sub: "조합원 전용",
      icon: "M20 12v10H4V12M22 7H2v5h20V7zM12 22V7M12 7a2 2 0 01-2-2c0-1.5 2-4 2-4s2 2.5 2 4a2 2 0 01-2 2z",
    },
    {
      id: "vote",
      label: "설문·투표",
      sub: "의견을 들려주세요",
      icon: "M3 10h18M3 10V6a2 2 0 012-2h14a2 2 0 012 2v4M3 10l2 10h14l2-10M10 6V4m4 2V4M12 14v2m0 0h-2m2 0h2",
    },
    {
      id: "inquiry",
      label: "1:1 문의",
      sub: "궁금한 점 문의",
      icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      id: "about",
      label: "지회 소개",
      sub: "지회 정보 안내",
      icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
    },
  ];

  const nowHour = new Date().getHours();
  const currentMealKey =
    nowHour >= 6 && nowHour < 10
      ? "아침"
      : nowHour >= 10 && nowHour < 15
      ? "점심"
      : nowHour >= 15 && nowHour < 20
      ? "저녁"
      : null;
  const currentMealEmoji = { 아침: "🌅", 점심: "☀️", 저녁: "🌙" };
  const todayMenu = currentMealKey
    ? dummyCanteen["대공원"][currentMealKey]
    : null;

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: "#F4F3FF",
        minHeight: "100vh",
        paddingBottom: 80,
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #3730A3 0%, #4F46E5 50%, #6D28D9 100%)",
          padding: "44px 20px 18px",
          color: "#fff",
          borderRadius: 28,
          margin: "8px 8px 0",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}
          >
            <EmblemImg
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.5)",
                flexShrink: 0,
                objectFit: "cover",
                background: "#fff",
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.75)",
                  marginBottom: 2,
                }}
              >
                서울교통공사노동조합
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 900,
                  letterSpacing: -0.5,
                  color: "#fff",
                  lineHeight: 1.2,
                }}
              >
                대공원승무지회
              </div>
              <div
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  color: "rgba(255,255,255,0.85)",
                }}
              >
                우리 모두의 한 걸음 ·{" "}
                <span style={{ color: "#C4B5FD", fontWeight: 700 }}>
                  노동조건 변화의 시작
                </span>
              </div>
            </div>
          </div>
          <div
            style={{
              position: "relative",
              flexShrink: 0,
              display: "flex",
              gap: 8,
            }}
          >
            {user?.is_admin && (
              <button
                onClick={() => setScreen("admin")}
                style={{
                  background: "rgba(255,255,255,0.2)",
                  border: "1.5px solid rgba(255,255,255,0.4)",
                  borderRadius: "50%",
                  width: 40,
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 18 }}>⚙️</span>
              </button>
            )}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setScreen("notifications")}
                style={{
                  background: "rgba(255,255,255,0.15)",
                  border: "none",
                  borderRadius: "50%",
                  width: 40,
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <Icon
                  path="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  color="#fff"
                  size={22}
                />
              </button>
              {totalAlertCount > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    background: "#EF4444",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: "50%",
                    width: 18,
                    height: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {totalAlertCount > 99 ? "99+" : totalAlertCount}
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div
            onClick={() => {
              setAboutInitialTab("members");
              setScreen("about");
            }}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.15)",
              borderRadius: 14,
              padding: "8px 6px",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.7)",
                marginBottom: 3,
              }}
            >
              조합원
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "#fff",
                lineHeight: 1,
              }}
            >
              {memberCount}
            </div>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.6)",
                marginTop: 2,
              }}
            >
              명
            </div>
          </div>
          <div
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.15)",
              borderRadius: 14,
              padding: "8px 6px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.7)",
                marginBottom: 3,
              }}
            >
              앱이용
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "#C4B5FD",
                lineHeight: 1,
              }}
            >
              {appUserCount}
            </div>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.6)",
                marginTop: 2,
              }}
            >
              명
            </div>
          </div>
          <div
            onClick={() => setShowOnlineModal(true)}
            style={{
              flex: 1,
              background: "rgba(255,255,255,0.15)",
              borderRadius: 14,
              padding: "8px 6px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                marginBottom: 3,
              }}
            >
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "#4ADE80",
                }}
              />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.7)" }}>
                접속중
              </span>
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "#4ADE80",
                lineHeight: 1,
              }}
            >
              0
            </div>
            <div
              style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.6)",
                marginTop: 2,
              }}
            >
              명
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 16px 0" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "14px 12px",
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            }}
          >
            <div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 1 }}>
              이번 달
            </div>
            <div style={{ fontSize: 10, color: "#9CA3AF", marginBottom: 6 }}>
              예상 실수령액
            </div>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#1F2937" }}>
              {(() => {
                const d = homeSalaryData;
                console.log("홈급여데이터:", d);
                if (!d || !d.memberInfo) return "—";
                const s = d.settings || {};
                const result = computeNetPay({
                  grade: Number(d.memberInfo.grade) || 0,
                  hobong: Number(d.memberInfo.pay_step) || 0,
                  workType: s.work_type || d.memberInfo.work_type || "",
                  checkedItems: s.checked_items || {},
                  manualInputs: s.manual_inputs || {},
                  nightCount: 0,
                  salaryTable: d.salaryTable,
                  worktypeSettings: d.worktypeSettings,
                  hfRecords: d.hfRecords,
                  diaTable: homeDia,
                  holidays: homeHolidays,
                  dedRates: d.dedRates,
                  memberInfo: d.memberInfo,
                  rotationData: homeRotation,
                });
                if (!result) return "—";
                return result.netPay.toLocaleString("ko-KR");
              })()}<span style={{ fontSize: 11, fontWeight: 400 }}>원</span>
            </div>
            
          </div>
       {(() => {
            const info = user ? getTodayWorkInfo(user, homeRotation, homeDia, homeHolidays) : null;
            const type = info?.type || "-";
            const dr = info?.diaRow;
            const timeText =
              dr && dr.start_time && dr.end_time
                ? `${dr.start_time}~${dr.end_time}`
                : type === "비번"
                ? "비번"
                : type === "휴무"
                ? "휴무"
                : "-";
            let workText = "";
            const wh = dr?.work_hours;
            if (wh != null && wh !== "") {
              const h = Math.floor(Number(wh));
              const mn = Math.round((Number(wh) - h) * 60);
              workText = mn > 0 ? `${h}시간 ${mn}분` : `${h}시간`;
            }
            const isWork = type === "주간" || type === "야간";
            return (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  padding: "14px 12px",
                  boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: 10, color: "#9CA3AF" }}>오늘 내 근무</div>
                  <span
                    style={{
                      background: "#EEF0FF",
                      color: type === "야간" ? "#6D28D9" : "#4F46E5",
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 6,
                      padding: "2px 6px",
                    }}
                  >
                    {type}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 900,
                    color: "#1F2937",
                    letterSpacing: -0.5,
                  }}
                >
                  {timeText}
                </div>
                {workText && (
                  <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>
                    {workText}
                  </div>
                )}
                {isWork && info?.dia != null && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "#4F46E5",
                      marginTop: 4,
                      fontWeight: 600,
                    }}
                  >
                    💎 승무다이아 : {info.dia}
                  </div>
                )}
              </div>
            );
          })()}
          <div
            onClick={() => setScreen("workAdjust")}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "14px 12px",
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 10, color: "#9CA3AF" }}>근무조정</div>
              <span
                style={{
                  background: "#EEF0FF",
                  color: "#4F46E5",
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "2px 6px",
                }}
              >
                입력
              </span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#1F2937" }}>
              {adjustCount}
              <span style={{ fontSize: 11, fontWeight: 400 }}>건</span>
            </div>
            <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>
              이번 달 신청
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#4F46E5",
                marginTop: 4,
                fontWeight: 600,
              }}
            >
              {lastDate
                ? `최근 ${lastDate.slice(5).replace("-", "/")}`
                : "기록 없음"}
            </div>
          </div>
        </div>
        {/* 호봉 승급 알림 배너 */}
        {promoAlert && (
          <div
            style={{
              background: "linear-gradient(135deg, #fef3c7, #fde68a)",
              border: "1.5px solid #fbbf24",
              borderRadius: 14,
              padding: "14px 16px",
              marginBottom: 12,
              position: "relative",
            }}
          >
            <button
              onClick={() => setPromoAlert(null)}
              style={{
                position: "absolute",
                top: 10,
                right: 12,
                background: "none",
                border: "none",
                fontSize: 16,
                color: "#92400e",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "#fbbf24",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: 20,
                }}
              >
                🎉
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#92400e",
                    marginBottom: 3,
                  }}
                >
                  {promoAlert.daysLeft === 0
                    ? "오늘 호봉이 승급됩니다!"
                    : `${promoAlert.daysLeft}일 후 호봉 승급 예정!`}
                </div>
                <div
                  style={{ fontSize: 12, color: "#b45309", lineHeight: 1.6 }}
                >
                  {promoAlert.isMax ? (
                    <>
                      <strong>{promoAlert.promoDate}</strong>에 최고{" "}
                      <strong>40호봉</strong>에 도달합니다! 🏆
                      <br />
                      정말 수고 많으셨습니다! 감사합니다 🙏
                    </>
                  ) : (
                    <>
                      {promoAlert.promoDate}에{" "}
                      <strong>{promoAlert.nextPayStep}호봉</strong>으로
                      승급됩니다 🎊
                      <br />
                      축하드립니다! 수고하셨습니다 💪
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <HomeCarousel
          urgentNotice={urgentNotice}
          carouselNotices={carouselNotices}
          onUrgentClick={() => setScreen("noticeList")}
          onCondolenceClick={() => { setBoardTab("경조사"); setScreen("board"); }}
          user={user}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "14px",
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {currentMealKey && (
                  <span style={{ fontSize: 14 }}>
                    {currentMealEmoji[currentMealKey]}
                  </span>
                )}
                <span
                  style={{ fontSize: 13, fontWeight: 700, color: "#1F2937" }}
                >
                  {currentMealKey ? `${currentMealKey} 메뉴` : "식당 메뉴"}
                </span>
              </div>
            </div>
            {todayMenu ? (
              <>
                {todayMenu.items
                  .filter((_, i) => i < 4)
                  .map((item, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 12,
                        color: "#374151",
                        marginBottom: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: "#4F46E5",
                          flexShrink: 0,
                        }}
                      />
                      {item.name.split(" / ")[0]}
                    </div>
                  ))}
              </>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: "#9CA3AF",
                  lineHeight: 1.5,
                  marginBottom: 4,
                }}
              >
                현재 운영 중인
                <br />
                식당이 없습니다
              </div>
            )}
            <div
              onClick={() => setScreen("canteen")}
              style={{
                fontSize: 12,
                color: "#4F46E5",
                fontWeight: 600,
                marginTop: 8,
                cursor: "pointer",
              }}
            >
              전체 메뉴 보기 ›
            </div>
          </div>
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: "14px",
              boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1F2937" }}>
                진행 중인 투표
              </span>
              <span
                onClick={() => setScreen("vote")}
                style={{ fontSize: 11, color: "#4F46E5", cursor: "pointer" }}
              >
                더보기 ›
              </span>
            </div>
            {activeVote ? (
              <>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#1F2937",
                    lineHeight: 1.4,
                    marginBottom: 8,
                  }}
                >
                  {activeVote.title}
                </div>
                <div
                  style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 6 }}
                >
                  참여기간 ~ {activeVote.deadline}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#4F46E5",
                    marginBottom: 4,
                  }}
                >
                  참여율{" "}
                  {Math.round((activeVote.voted / activeVote.total) * 100)}%
                  <span
                    style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 400 }}
                  >
                    {" "}
                    ({activeVote.voted}명)
                  </span>
                </div>
                <div
                  style={{
                    background: "#F3F4F6",
                    borderRadius: 10,
                    height: 6,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      background: "linear-gradient(90deg, #4F46E5, #6D28D9)",
                      borderRadius: 10,
                      width: `${Math.round(
                        (activeVote.voted / activeVote.total) * 100
                      )}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: "#9CA3AF",
                  textAlign: "center",
                  marginTop: 16,
                }}
              >
                진행중인 투표가 없습니다
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: "16px 12px",
            marginBottom: 12,
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 4,
            }}
          >
            {newMenus.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "notice") setScreen("noticeList");
                  if (item.id === "canteen") setScreen("canteen");
                  if (item.id === "board") { setBoardTab("전체"); setScreen("board"); }
                  if (item.id === "inquiry") setScreen("inquiry");
                  if (item.id === "welfare") setScreen("welfare");
                  if (item.id === "vote") setScreen("vote");
                  if (item.id === "anonymous") setScreen("anonymous");
                  if (item.id === "archive") setScreen("archive");
                  if (item.id === "about") setScreen("about");
                  if (item.id === "leave") setScreen("leave");
                  if (item.id === "salary") setScreen("salary");
                  if (item.id === "schedule") setScreen("schedule");
                }}
                style={{
                  background: "none",
                  border: "none",
                  borderRadius: 12,
                  padding: "12px 4px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "#F4F3FF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {item.emoji ? (
                    <span
                      style={{
                        fontSize: 20,
                        fontWeight: 900,
                        color: "#4F46E5",
                      }}
                    >
                      {item.emoji}
                    </span>
                  ) : (
                    <Icon
                      path={item.icon}
                      size={22}
                      color="#4F46E5"
                      strokeWidth={1.5}
                    />
                  )}
                </div>
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{ fontSize: 12, fontWeight: 700, color: "#1F2937" }}
                  >
                    {item.label}
                  </div>
                  <div style={{ fontSize: 9, color: "#9CA3AF", marginTop: 2 }}>
                    {item.sub}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: "16px",
            boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 14, color: "#1F2937" }}>
              최근 공지사항
            </span>
            <span
              onClick={() => setScreen("noticeList")}
              style={{ color: "#4F46E5", fontSize: 12, cursor: "pointer" }}
            >
              더보기 ›
            </span>
          </div>
          {displayNotices.slice(0, 3).map((n, i) => (
            <div
              key={n.id}
              onClick={() => {
                setSelectedNotice(n);
                setScreen("noticeDetail");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 0",
                borderBottom: i < 2 ? "1px solid #F3F4F6" : "none",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  background: n.tagBg,
                  color: n.tagColor,
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 6,
                  padding: "2px 6px",
                  whiteSpace: "nowrap",
                }}
              >
                {n.tag}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: "#1F2937",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {n.title}
              </span>
              <span style={{ color: "#9CA3AF", fontSize: 11 }}>{n.date}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: "16px 0 8px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <svg
              viewBox="0 0 500 420"
              width="72"
              height="60"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M250,18 C155,18 72,82 50,170 C36,225 46,272 76,312"
                stroke="#1e40af"
                strokeWidth="16"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M250,34 C162,34 86,93 66,178 C54,228 62,272 88,308"
                stroke="#1e40af"
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
                opacity="0.35"
              />
              <circle cx="36" cy="178" r="12" fill="#1e40af" opacity="0.85" />
              <circle cx="36" cy="178" r="5" fill="#ffd700" />
              <path
                d="M250,18 C345,18 428,82 450,170 C464,225 454,272 424,312"
                stroke="#daa520"
                strokeWidth="16"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M250,34 C338,34 414,93 434,178 C446,228 438,272 412,308"
                stroke="#daa520"
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
                opacity="0.35"
              />
              <circle cx="464" cy="178" r="12" fill="#daa520" opacity="0.85" />
              <circle cx="464" cy="178" r="5" fill="#1e40af" />
              <circle
                cx="250"
                cy="175"
                r="122"
                stroke="#1e40af"
                strokeWidth="2"
                fill="none"
                strokeDasharray="7,5"
                opacity="0.3"
              />
              <circle cx="196" cy="112" r="21" fill="#1e40af" />
              <path
                d="M165,225 Q168,182 196,172 Q214,177 219,195 L215,228 Z"
                fill="#1e40af"
              />
              <path
                d="M219,190 Q233,198 244,196"
                stroke="#1e40af"
                strokeWidth="11"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M168,192 Q155,202 148,214"
                stroke="#1e40af"
                strokeWidth="11"
                fill="none"
                strokeLinecap="round"
              />
              <circle cx="304" cy="112" r="21" fill="#daa520" />
              <path
                d="M335,225 Q332,182 304,172 Q286,177 281,195 L285,228 Z"
                fill="#daa520"
              />
              <path
                d="M281,190 Q267,198 256,196"
                stroke="#daa520"
                strokeWidth="11"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M332,192 Q345,202 352,214"
                stroke="#daa520"
                strokeWidth="11"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M244,196 Q250,218 256,196"
                stroke="#1e40af"
                strokeWidth="7"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M76,312 Q106,336 140,330 Q163,324 180,312"
                stroke="#1e40af"
                strokeWidth="15"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M76,312 Q62,327 66,346 Q71,358 88,352 Q101,346 106,334"
                stroke="#1e40af"
                strokeWidth="12"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M66,346 Q58,355 62,366 Q68,374 81,368"
                stroke="#1e40af"
                strokeWidth="9"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M424,312 Q394,336 360,330 Q337,324 320,312"
                stroke="#daa520"
                strokeWidth="15"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M424,312 Q438,327 434,346 Q429,358 412,352 Q399,346 394,334"
                stroke="#daa520"
                strokeWidth="12"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M434,346 Q442,355 438,366 Q432,374 419,368"
                stroke="#daa520"
                strokeWidth="9"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M180,312 Q250,296 320,312"
                stroke="#555"
                strokeWidth="13"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M185,309 Q250,294 315,309"
                stroke="#888"
                strokeWidth="6"
                fill="none"
                strokeLinecap="round"
              />
              <text
                x="65"
                y="408"
                fontSize="112"
                fontWeight="900"
                fill="#1e3a8a"
                fontFamily="'Apple SD Gothic Neo','Noto Sans KR',sans-serif"
              >
                모
              </text>
              <text
                x="210"
                y="408"
                fontSize="112"
                fontWeight="900"
                fill="#daa520"
                fontFamily="'Apple SD Gothic Neo','Noto Sans KR',sans-serif"
              >
                U
              </text>
              <text
                x="312"
                y="408"
                fontSize="112"
                fontWeight="900"
                fill="#1e3a8a"
                fontFamily="'Apple SD Gothic Neo','Noto Sans KR',sans-serif"
              >
                다
              </text>
            </svg>
          </div>
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: "#1e3a8a",
                marginBottom: 4,
              }}
            >
              모U다 플랫폼
            </div>
            <div
              style={{
                display: "flex",
                gap: 4,
                fontSize: 11,
                color: "#555",
                marginBottom: 6,
                alignItems: "center",
              }}
            >
              <span>노동</span>
              <span style={{ color: "#daa520", fontWeight: 900 }}>•</span>
              <span>권리</span>
              <span style={{ color: "#daa520", fontWeight: 900 }}>•</span>
              <span>복지</span>
              <span style={{ color: "#daa520", fontWeight: 900 }}>•</span>
              <span>소통</span>
            </div>
            <div style={{ fontSize: 10, color: "#9CA3AF" }}>
              Copyright © 2026. All rights reserved.
            </div>
          </div>
        </div>
      </div>
      <BottomTabBar screen={screen} setScreen={setScreen} />
            
    </div>
  );
}
