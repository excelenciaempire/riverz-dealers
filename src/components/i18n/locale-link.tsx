"use client";

import NextLink from "next/link";
import { forwardRef, type ComponentProps } from "react";
import { useLocale } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n/routes";

type NextLinkProps = ComponentProps<typeof NextLink>;

/**
 * Drop-in replacement for next/link that rewrites the first path segment to
 * the active locale's slug (e.g. /bandeja → /inbox in English). Import it as
 * the default `Link` so existing <Link> JSX needs no other changes:
 *
 *   import Link from "@/components/i18n/locale-link";
 *
 * External/anchor hrefs and unknown routes pass through untouched, and the
 * canonical Spanish path always resolves too (next.config rewrites), so a
 * link that isn't swapped never breaks — it just shows the Spanish slug.
 */
const LocaleLink = forwardRef<HTMLAnchorElement, NextLinkProps>(
  function LocaleLink({ href, ...rest }, ref) {
    const { locale } = useLocale();
    let localized = href;
    if (typeof href === "string") {
      localized = localizePath(href, locale);
    } else if (
      href &&
      typeof href === "object" &&
      typeof href.pathname === "string"
    ) {
      localized = { ...href, pathname: localizePath(href.pathname, locale) };
    }
    return <NextLink ref={ref} href={localized} {...rest} />;
  },
);

export default LocaleLink;
