import { Layout } from "@/components/Layout";

export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Layout title={title}>
      <div className="card-luxury flex flex-col items-center gap-2 p-10 text-center">
        <p className="font-heading text-lg font-bold text-text-1">
          Coming soon
        </p>
        <p className="text-sm text-text-3">{description}</p>
      </div>
    </Layout>
  );
}

export function ChatsComingSoon() {
  return (
    <ComingSoon
      title="Chats"
      description="Direct messaging with support and other students is on the way."
    />
  );
}

export function ProfileComingSoon() {
  return (
    <ComingSoon
      title="Profile"
      description="Editing your name, university, WhatsApp number, and password from here is on the way."
    />
  );
}
