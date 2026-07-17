export default function ReposPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Repos</h1>
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <p className="font-medium">Aucun repo pour l&apos;instant</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Les repos surveillés apparaîtront ici.
        </p>
      </div>
    </div>
  );
}
