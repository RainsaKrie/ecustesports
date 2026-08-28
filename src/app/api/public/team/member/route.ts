// 旧版“按玩家 ID 直接加队”入口已停用。
// 当前组队必须通过 /api/public/team/request 发起申请或邀请，并由对方确认。

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { message: "直接加入队伍的方式已停用，请使用申请或邀请流程。" },
    { status: 410 },
  );
}
