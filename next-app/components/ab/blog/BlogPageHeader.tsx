"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

type BlogPageHeaderProps = {
  title: string;
  subtitle?: string;
  backHref?: string;
  backOnClick?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  sticky?: boolean;
};

export default function BlogPageHeader({
  title,
  subtitle,
  backHref,
  backOnClick,
  backLabel = "Назад",
  actions,
  sticky = true,
}: BlogPageHeaderProps) {
  const backInner = <ArrowLeft size={22} strokeWidth={2.2} aria-hidden="true" />;

  const backControl =
    backHref != null ? (
      <Link href={backHref} className="blog-page__back" aria-label={backLabel}>
        {backInner}
      </Link>
    ) : (
      <button type="button" className="blog-page__back" onClick={backOnClick} aria-label={backLabel}>
        {backInner}
      </button>
    );

  return (
    <header className={"blog-page__head" + (sticky ? " blog-page__head--sticky" : "")}>
      {backControl}
      <div className="blog-page__head-main">
        <h1 className="blog-page__title">{title}</h1>
        {subtitle ? <p className="blog-page__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="blog-page__head-actions">{actions}</div> : null}
    </header>
  );
}
