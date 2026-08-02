"use client";

import { useMemo } from "react";
import D3Deployment, { Rectum } from "@yanqirenshi/d3.deployment";
import { DEPLOYMENT_DATA } from "@/data/deployment";

export default function DeploymentTab() {
  const rectum = useMemo(() => {
    const instance = new Rectum({});
    instance.data(DEPLOYMENT_DATA);
    return instance;
  }, []);

  return (
    <div className="flex min-h-0 w-full flex-1">
      <D3Deployment rectum={rectum} />
    </div>
  );
}
