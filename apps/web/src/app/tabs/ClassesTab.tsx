"use client";

import { useEffect, useRef } from "react";
import { ClassDiagram } from "@yanqirenshi/d3.classes";
import { SESSION_LINE_CLASS_DATA } from "@/data/classes-session-line";

export default function ClassesTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const diagram = new ClassDiagram(container);
    diagram.loadFromData(SESSION_LINE_CLASS_DATA).render();

    return () => {
      diagram.clear();
      container.innerHTML = "";
    };
  }, []);

  return <div ref={containerRef} className="min-h-0 w-full flex-1" />;
}
