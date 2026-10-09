"use client";

import FeedLinkPanel from "@/components/calendar/FeedLinkPanel";
import { portalCalendarApi } from "@/lib/api";

/**
 * The cabinet's calendar link: the student's lessons and make-ups as a
 * read-only calendar a phone's calendar app can subscribe to.
 */
export default function PortalCalendar() {
  return (
    <div style={{ marginTop: 14 }}>
      <FeedLinkPanel api={portalCalendarApi} />
    </div>
  );
}
