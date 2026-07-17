import Link from "next/link";

const NAV = [
  { label: "Repos", href: "/repos" },
  { label: "Revues", href: "/reviews" },
  { label: "Activité", href: "/activity" },
];

export function Sidebar() {
  return (
    <aside className="flex w-56 flex-col border-r bg-background p-4">
      <span className="mb-6 px-2 text-lg font-semibold">skycode</span>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
