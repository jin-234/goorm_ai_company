"use client";
/**
 * 장소 → 패널, 단계 → 자동으로 열 장소. 화면 틀(OfficeApp)은 이 둘만 가져다 쓴다.
 * 패널 안에는 닫기 버튼을 두지 않는다(틀이 ×·Esc로 닫는다).
 */
import type { ReactNode } from "react";
import type { OfficeView } from "../api";
import type { PlaceId } from "../ui";
import type { OfficeHandle } from "../useOffice";
import { CheckIn } from "./CheckIn";
import { Desk } from "./Desk";
import { MailBox } from "./Mail";
import { MorningPT } from "./MorningPT";
import { OvertimePanel } from "./Enforcement";
import { DayClose, DayEnd } from "./Review";
import { Settings } from "./Settings";
import { Share } from "./Share";

export { Onboarding } from "./Onboarding";

/** 단계가 바뀌면 자동으로 열 장소. */
export function placeForPhase(view: OfficeView): PlaceId {
  switch (view.phase.value) {
    case "beforeCheckIn":
      return "door";
    case "morningPT":
      return "meeting";
    case "sharing":
      return "share";
    default:
      return "desk";
  }
}

export function renderPanel(place: PlaceId, office: OfficeHandle, view: OfficeView, go: (p: PlaceId) => void): ReactNode {
  switch (place) {
    case "door":
      return <CheckIn office={office} view={view} onDone={() => go("meeting")} />;
    case "meeting":
      return <MorningPT office={office} view={view} />;
    case "share":
      return <Share office={office} view={view} onGo={go} />;
    case "manager":
      return <MailBox office={office} view={view} onGo={go} />;
    case "settings":
      return <Settings office={office} view={view} />;
    case "desk":
      if (view.phase.value === "checkoutReview") return <DayClose office={office} view={view} onGo={go} />;
      if (view.phase.value === "off") return <DayEnd office={office} view={view} onGo={go} />;
      if (["checkout", "dinner", "overtime", "overtimeReview"].includes(view.phase.value)) return <OvertimePanel office={office} view={view} />;
      return <Desk office={office} view={view} onGo={go} />;
  }
}
