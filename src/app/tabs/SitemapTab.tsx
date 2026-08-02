"use client";

import { useMemo } from "react";
import D3Sitemap, { Rectum } from "@yanqirenshi/d3.sitemap";
import { SITEMAP_DATA } from "@/data/sitemap";

export default function SitemapTab() {
  const rectum = useMemo(() => {
    const instance = new Rectum({});
    instance.data(SITEMAP_DATA);
    return instance;
  }, []);

  return (
    <div className="flex min-h-0 w-full flex-1">
      <D3Sitemap rectum={rectum} />
    </div>
  );
}
