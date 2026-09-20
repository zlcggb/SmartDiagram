import type { InterviewRecord, RecruitCandidateRecord } from './types'

const STORAGE_KEY = 'smartdiagram-recruit-records-v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function parseRecruitRecords(raw: string | null): RecruitCandidateRecord[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is RecruitCandidateRecord => Boolean(item && typeof item === 'object' && typeof item.id === 'string'))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  } catch {
    return []
  }
}

function browserStorage(): StorageLike {
  return window.localStorage
}

export function createRecruitStorage(storage: StorageLike = browserStorage()) {
  const read = () => parseRecruitRecords(storage.getItem(STORAGE_KEY))

  const write = (records: RecruitCandidateRecord[]) => {
    storage.setItem(STORAGE_KEY, JSON.stringify(records))
  }

  return {
    list() {
      return read()
    },
    save(record: RecruitCandidateRecord) {
      const records = read().filter((item) => item.id !== record.id)
      records.unshift(record)
      write(records)
      return records
    },
    appendInterview(candidateId: string, interview: InterviewRecord) {
      const records = read().map((item) => item.id === candidateId
        ? { ...item, interviews: [interview, ...item.interviews] }
        : item)
      write(records)
      return records
    }
  }
}

export const recruitStorage = createRecruitStorage()
