"use client";

import type { AnchorHTMLAttributes, AudioHTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { useFileUrl, type FileScope } from "@/lib/files";

// Private uploads shown through signed links (lib/files.ts). While the link
// is being fetched nothing is requested from the server by name; when the
// caller may not open the file the element shows nothing (or a muted label).

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { name: string | null | undefined; scope?: FileScope; children: ReactNode };

export function PrivateLink({ name, scope = "staff", children, style, ...rest }: LinkProps) {
  const url = useFileUrl(name, scope);
  if (!name) return null;
  if (!url) {
    return (
      <span aria-disabled="true" style={{ ...style, opacity: 0.6, cursor: "default" }}>
        {children}
      </span>
    );
  }
  return (
    <a {...rest} style={style} href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

type ImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { name: string | null | undefined; scope?: FileScope };

export function PrivateImg({ name, scope = "staff", alt = "", ...rest }: ImgProps) {
  const url = useFileUrl(name, scope);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...rest} alt={alt} src={url} />;
}

type AudioProps = Omit<AudioHTMLAttributes<HTMLAudioElement>, "src"> & { name: string | null | undefined; scope?: FileScope };

export function PrivateAudio({ name, scope = "staff", ...rest }: AudioProps) {
  const url = useFileUrl(name, scope);
  if (!url) return null;
  return <audio {...rest} src={url} />;
}
