import { notFound } from "next/navigation";
import GameLanding from "@/components/legacy/GameLanding";
import { getLegacyGame, LEGACY_GAMES } from "@/lib/legacy-site-content";

export function generateStaticParams() {
  return LEGACY_GAMES.map((game) => ({ game: game.slug }));
}

export default async function GamePage({ params }: { params: Promise<{ game: string }> }) {
  const { game: slug } = await params;
  const game = getLegacyGame(slug);
  if (!game) notFound();
  return <GameLanding game={game} />;
}
