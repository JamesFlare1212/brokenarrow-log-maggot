import { TableSkeletonRows } from '../../components/LoadingState';

export function ProfileTableSkeleton({ columns }: { columns: readonly string[] }) {
  return <TableSkeletonRows columns={columns} alignRight={['eloDelta']} compact />;
}
