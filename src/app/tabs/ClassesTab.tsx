"use client";

import { useEffect, useRef } from "react";
import { ClassDiagram, type DiagramInput } from "@yanqirenshi/d3.classes";

const CLASS_DATA: DiagramInput = {
  classes: [
    {
      name: { physical: "User", logical: "ユーザー", description: "" },
      attributes: [
        "+ id: number",
        "+ name: string",
        "+ email: string",
      ],
      methods: ["+ getName(): string"],
      position: { x: 40, y: 40 },
    },
    {
      name: { physical: "Admin", logical: "管理者", description: "" },
      stereotype: "extends",
      attributes: ["+ role: string"],
      methods: ["+ approve(): void"],
      position: { x: 40, y: 260 },
    },
    {
      name: { physical: "Order", logical: "注文", description: "" },
      attributes: [
        "+ id: number",
        "+ userId: number",
        "+ total: number",
      ],
      methods: ["+ getTotal(): number"],
      position: { x: 400, y: 40 },
    },
  ],
  relationships: [
    {
      type: "inheritance",
      from: { classId: "class-2", point: "bottom" },
      to: { classId: "class-1", point: "top" },
    },
    {
      type: "association",
      from: { classId: "class-1", point: "right" },
      to: { classId: "class-3", point: "left" },
      label: "発注する",
    },
  ],
};

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
