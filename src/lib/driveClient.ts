import { getDriveAccessToken, refreshDriveTokenWithPopup } from './firebase';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

export async function listDriveExcelFiles(searchQuery = ''): Promise<DriveFileItem[]> {
  let token = getDriveAccessToken();
  if (!token) {
    token = await refreshDriveTokenWithPopup();
  }
  if (!token) {
    throw new Error('لم يتم الحصول على صلاحية الوصول إلى Google Drive.');
  }

  const qParts = [
    "trashed = false",
    "(mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or name contains '.xlsx')",
  ];
  if (searchQuery.trim()) {
    const safe = searchQuery.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${safe}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'files(id,name,mimeType,modifiedTime,size)',
    orderBy: 'modifiedTime desc',
    pageSize: '30',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    const freshToken = await refreshDriveTokenWithPopup();
    if (!freshToken) throw new Error('انتهت صلاحية جلسة Google Drive.');
    const retry = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) throw new Error('تعذر قراءة الملفات من Google Drive.');
    const data = (await retry.json()) as { files?: DriveFileItem[] };
    return data.files || [];
  }

  if (!res.ok) {
    throw new Error('تعذر استعراض ملفات Google Drive.');
  }
  const data = (await res.json()) as { files?: DriveFileItem[] };
  return data.files || [];
}
