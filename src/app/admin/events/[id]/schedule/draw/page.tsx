"use client";

import { use } from "react";
import FormatDrawWorkspace from "@/components/admin/FormatDrawWorkspace";

interface DrawPageProps {
  params: Promise<{ id: string }>;
}

export default function DrawPage({ params }: DrawPageProps) {
  const { id } = use(params);
  return <FormatDrawWorkspace eventId={id} />;
}
