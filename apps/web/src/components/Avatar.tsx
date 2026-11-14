import type { MemberInfo } from "@sofa/shared";
import clsx from "clsx";
import { initials } from "../lib/format";

type Props = { member: Pick<MemberInfo, "name" | "color">; size?: "sm" | "md"; className?: string };

export function Avatar({ member, size = "md", className }: Props) {
  return (
    <span
      className={clsx("avatar", size === "sm" && "avatar-sm", className)}
      style={{ background: member.color }}
      aria-hidden="true"
    >
      {initials(member.name)}
    </span>
  );
}
