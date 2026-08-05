/**
 * Plain-language narration of a trace event.
 *
 * `describeEvent` in `lib/sim/trace` is the *technical* rendering — it is part of the
 * determinism digest, it is terse on purpose, and it must not change. This is the
 * other half: the same event said in a sentence, for a reader who has not read the
 * paper and does not yet know what AppendEntries is.
 *
 * This decides nothing. It switches on an event the simulation has already recorded
 * and chooses words for it — the same relationship to the trace that a colour or a
 * shape has. No algorithm state is computed here, and nothing here feeds back into
 * the simulation.
 *
 * Algorithm terms stay in English inside the sentence — *term*, *leader*, *commit* —
 * because a reader should recognise them in the paper afterwards. The scaffolding
 * around them is the interface language.
 */

import type { Locale } from '@/lib/i18n'
import type { TraceEvent } from '@/lib/sim/trace'

/** `n0`, `n1` — short enough to sit inside a sentence without breaking its rhythm. */
function n(id: number): string {
  return `n${id}`
}

export function narrateEvent(event: TraceEvent, locale: Locale): string {
  const id = locale === 'id'
  switch (event.kind) {
    case 'start':
      return id
        ? 'Awal simulasi. Semua node adalah follower dan belum ada leader.'
        : 'The run begins. Every node is a follower and there is no leader yet.'

    case 'deliver': {
      const dup = event.isDuplicate ? (id ? ' (salinan kedua)' : ' (a duplicate)') : ''
      const m = event.message
      switch (m.type) {
        case 'RequestVote':
          return id
            ? `${n(m.from)} meminta suara ${n(m.to)} untuk term ${m.term}.${dup}`
            : `${n(m.from)} asks ${n(m.to)} for its vote in term ${m.term}.${dup}`
        case 'RequestVoteResponse':
          return m.voteGranted
            ? id
              ? `${n(m.from)} memberikan suaranya kepada ${n(m.to)}.${dup}`
              : `${n(m.from)} grants its vote to ${n(m.to)}.${dup}`
            : id
              ? `${n(m.from)} menolak memilih ${n(m.to)}.${dup}`
              : `${n(m.from)} refuses to vote for ${n(m.to)}.${dup}`
        case 'AppendEntries':
          return m.entries.length === 0
            ? id
              ? `Leader ${n(m.from)} mengabari ${n(m.to)} bahwa ia masih memimpin (term ${m.term}).${dup}`
              : `Leader ${n(m.from)} tells ${n(m.to)} it is still in charge (term ${m.term}).${dup}`
            : id
              ? `Leader ${n(m.from)} mengirim ${m.entries.length} entry ke ${n(m.to)}, mulai baris ${m.prevLogIndex + 1}.${dup}`
              : `Leader ${n(m.from)} sends ${m.entries.length} ${m.entries.length === 1 ? 'entry' : 'entries'} to ${n(m.to)}, starting at row ${m.prevLogIndex + 1}.${dup}`
        case 'AppendEntriesResponse':
          return m.success
            ? id
              ? `${n(m.from)} menerima catatan dari ${n(m.to)}: kedua log cocok.${dup}`
              : `${n(m.from)} accepts the entries from ${n(m.to)}: the two logs agree.${dup}`
            : id
              ? `${n(m.from)} menolak: catatan sebelumnya tidak cocok, jadi leader ${n(m.to)} akan mundur satu baris dan mencoba lagi.${dup}`
              : `${n(m.from)} rejects: the preceding row does not match, so leader ${n(m.to)} will back up a row and retry.${dup}`
        case 'InstallSnapshot':
          return id
            ? `Leader ${n(m.from)} mengirim snapshot ke ${n(m.to)} — ${n(m.to)} tertinggal terlalu jauh untuk dikejar baris demi baris.${dup}`
            : `Leader ${n(m.from)} sends ${n(m.to)} a snapshot — ${n(m.to)} is too far behind to catch up row by row.${dup}`
        case 'InstallSnapshotResponse':
          return id
            ? `${n(m.from)} selesai memasang snapshot dari ${n(m.to)}.${dup}`
            : `${n(m.from)} has finished installing the snapshot from ${n(m.to)}.${dup}`
        default: {
          const unreachable: never = m
          throw new Error(`Unhandled message: ${JSON.stringify(unreachable)}`)
        }
      }
    }

    case 'drop': {
      const what = event.message.type
      const route = `${n(event.message.from)}→${n(event.message.to)}`
      switch (event.reason) {
        case 'network':
          return id
            ? `Pesan ${what} ${route} hilang di jaringan. Ini normal — Raft memang dirancang untuk jaringan yang suka menjatuhkan pesan.`
            : `A ${what} message ${route} was lost in the network. This is normal — Raft is designed for a network that drops things.`
        case 'partition':
          return id
            ? `Pesan ${what} ${route} tidak sampai: keduanya berada di sisi partisi yang berbeda.`
            : `A ${what} message ${route} did not arrive: the two are on opposite sides of a partition.`
        case 'crashed-sender':
          return id
            ? `Pesan ${what} ${route} tidak jadi terkirim — pengirimnya mati lebih dulu.`
            : `A ${what} message ${route} was never sent — its sender went down first.`
        case 'crashed-receiver':
          return id
            ? `Pesan ${what} ${route} tiba, tapi penerimanya sedang mati.`
            : `A ${what} message ${route} arrived, but its receiver is down.`
        default: {
          const unreachable: never = event.reason
          throw new Error(`Unhandled drop reason: ${String(unreachable)}`)
        }
      }
    }

    case 'timer':
      return event.timer === 'election'
        ? id
          ? `${n(event.node)} sudah terlalu lama tidak mendengar kabar leader, jadi ia mencalonkan diri dan membuka term baru.`
          : `${n(event.node)} has gone too long without hearing from a leader, so it stands for election and opens a new term.`
        : id
          ? `Giliran leader ${n(event.node)} mengirim kabar berkala supaya yang lain tidak menggelar pemilihan.`
          : `Time for leader ${n(event.node)} to send its periodic heartbeat, so nobody else calls an election.`

    case 'client-request':
      if (event.accepted) {
        return id
          ? `Sebuah permintaan klien “${event.command}” diterima leader ${n(event.node)} dan masuk ke ujung log-nya.`
          : `A client request “${event.command}” is accepted by leader ${n(event.node)} and lands at the end of its log.`
      }
      return event.redirectedTo === null
        ? id
          ? `Permintaan klien “${event.command}” dikirim ke ${n(event.node)}, yang bukan leader dan belum tahu siapa leader-nya — jadi permintaan itu tidak bisa diteruskan.`
          : `A client request “${event.command}” went to ${n(event.node)}, which is not the leader and does not know who is — so it cannot be forwarded.`
        : id
          ? `Permintaan klien “${event.command}” dikirim ke ${n(event.node)}, yang bukan leader, dan diarahkan ke ${n(event.redirectedTo)}.`
          : `A client request “${event.command}” went to ${n(event.node)}, which is not the leader, and was redirected to ${n(event.redirectedTo)}.`

    case 'crash':
      return id
        ? `${n(event.node)} mati. Ia berhenti mengirim dan menerima, tapi state persistennya tetap ada.`
        : `${n(event.node)} goes down. It stops sending and receiving, but its persistent state survives.`

    case 'restart':
      return id
        ? `${n(event.node)} hidup lagi sebagai follower, membawa currentTerm dan votedFor yang tersimpan.`
        : `${n(event.node)} comes back up as a follower, carrying its stored currentTerm and votedFor.`

    case 'partition': {
      const groups = new Set(event.partitionOf).size
      return groups <= 1
        ? id
          ? 'Jaringan kembali utuh.'
          : 'The network is whole again.'
        : id
          ? `Jaringan terbelah menjadi ${groups} kelompok. Pesan hanya lewat di dalam kelompok yang sama.`
          : `The network splits into ${groups} groups. Messages only pass within a group.`
    }

    case 'heal':
      return id
        ? 'Partisi disambung kembali; semua node bisa saling menghubungi lagi.'
        : 'The partition heals; every node can reach every other again.'

    case 'change-configuration':
      if (event.accepted) {
        return id
          ? `Perubahan keanggotaan diminta ke leader ${n(event.node)}: cluster menuju {${event.servers.join(', ')}}, lewat konfigurasi peralihan C-old,new.`
          : `A membership change is requested of leader ${n(event.node)}: the cluster heads for {${event.servers.join(', ')}}, by way of the transitional C-old,new.`
      }
      return event.redirectedTo === null
        ? id
          ? `Perubahan keanggotaan dikirim ke ${n(event.node)}, yang bukan leader dan belum tahu siapa leader-nya.`
          : `A membership change went to ${n(event.node)}, which is not the leader and does not know who is.`
        : id
          ? `Perubahan keanggotaan dikirim ke ${n(event.node)} dan diarahkan ke leader ${n(event.redirectedTo)}.`
          : `A membership change went to ${n(event.node)} and was redirected to leader ${n(event.redirectedTo)}.`

    default: {
      const unreachable: never = event
      throw new Error(`Unhandled trace event: ${JSON.stringify(unreachable)}`)
    }
  }
}
