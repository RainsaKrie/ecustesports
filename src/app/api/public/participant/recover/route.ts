import { updateEventData } from "@/lib/data-store";
import { getSiteConfig } from "@/lib/site-config";
import { issueParticipantToken, withoutParticipantSecret } from "@/lib/domains/identity/participant-auth";
import { isEventPublic } from "@/lib/configured-events";
import {
  initialRegistration,
  normalizeRegistrationState,
  type RegistrationPlayer,
  type RegistrationState,
} from "@/lib/scheduling/registration-data";
import { recoverParticipantAccess } from "@/lib/scheduling/participant-recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventId = text(body.eventId, 60);
    const studentId = text(body.studentId, 30);
    const phone = text(body.phone, 60);
    if (!eventId || !studentId || !phone) {
      return Response.json({ message: "请填写学号和报名手机号。" }, { status: 400 });
    }

    const config = await getSiteConfig();
    const event = config.events.find((candidate) => candidate.id === eventId);
    if (!event || !isEventPublic(event) || event.status === "archived") {
      return Response.json({ message: "赛事不存在或尚未公开。" }, { status: 404 });
    }

    const credential = issueParticipantToken();
    let player: RegistrationPlayer | undefined;
    await updateEventData<RegistrationState>(eventId, "registration", initialRegistration(), (raw) => {
      const result = recoverParticipantAccess(normalizeRegistrationState(raw), {
        studentId,
        phone,
        tokenHash: credential.tokenHash,
      });
      player = result.player;
      return result.state;
    });

    if (!player) {
      return Response.json({ message: "学号或报名手机号不匹配。" }, { status: 401 });
    }
    return Response.json({
      player: withoutParticipantSecret(player),
      manageToken: credential.token,
    });
  } catch {
    return Response.json({ message: "找回失败，请稍后重试。" }, { status: 400 });
  }
}
