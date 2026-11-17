/** Per-PR bot bookkeeping stored in the BotPrState table. */

export function getPrState(prisma, { owner, repo, number }) {
  const repoFullName = `${owner}/${repo}`;
  return prisma.botPrState.upsert({
    where: { repoFullName_prNumber: { repoFullName, prNumber: number } },
    create: { repoFullName, prNumber: number },
    update: {},
  });
}

export function updatePrState(prisma, { owner, repo, number }, data) {
  const repoFullName = `${owner}/${repo}`;
  return prisma.botPrState.upsert({
    where: { repoFullName_prNumber: { repoFullName, prNumber: number } },
    create: { repoFullName, prNumber: number, ...data },
    update: data,
  });
}
