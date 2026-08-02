"use client";

import { useEffect, useRef } from "react";
import { ClassDiagram } from "@yanqirenshi/d3.classes";
import { CLASS_DATA } from "@/data/classes";

export default function ClassesTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const diagram = new ClassDiagram(container);
    diagram.loadFromData(CLASS_DATA).render();

    return () => {
      diagram.clear();
      container.innerHTML = "";
    };
  }, []);

  return <div ref={containerRef} className="min-h-0 w-full flex-1" />;
}
