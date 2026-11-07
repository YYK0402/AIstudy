/**
 * 课程文件 id 解析与分配。
 * 课程数据文件按 course-<id> 命名存放于宿主存储目录；删课后文件按设计保留（孤儿文件），
 * 故新课程的 id 分配必须同时考虑磁盘上已存在的 course-<id> 文件，
 * 防止注册表丢失/重置后 id 序列重排、新文件覆盖孤儿文件造成数据丢失（2026-11-07 冒烟事故）。
 */

/** 从宿主存储目录的文件名列表中解析出课程文件 id 集合（course-<id>；.bak 等衍生文件自动排除） */
export function parseCourseFileIds(names: string[]): number[] {
  const ids = new Set<number>();
  for (const name of names) {
    const m = /^course-(\d+)$/.exec(name);
    if (m) ids.add(Number(m[1]));
  }
  return [...ids];
}

/**
 * 分配新课程 id：max(注册表内最大 id, 磁盘课程文件最大 id) + 1。
 * diskIds 为空（宿主不支持列举或列举失败）时退化为仅按注册表分配（旧行为）。
 */
export function nextCourseId(courses: Array<{ id: number }>, diskIds: number[]): number {
  let maxId = 0;
  for (const c of courses) if (c.id > maxId) maxId = c.id;
  for (const id of diskIds) if (id > maxId) maxId = id;
  return maxId + 1;
}
