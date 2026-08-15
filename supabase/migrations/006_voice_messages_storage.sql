-- Storage bucket for voice messages (public, auto-expire handled at app level)
insert into storage.buckets (id, name, public)
values ('voice-messages', 'voice-messages', true)
on conflict (id) do nothing;

-- Allow authenticated and anonymous uploads
create policy "voice_messages_insert" on storage.objects
  for insert with check (bucket_id = 'voice-messages');

-- Allow public reads
create policy "voice_messages_select" on storage.objects
  for select using (bucket_id = 'voice-messages');
