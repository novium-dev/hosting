import {
    Body,
    Button,
    Container,
    Head,
    Heading,
    Hr,
    Html,
    Preview,
    Section,
    Tailwind,
    Text
} from "@react-email/components";

interface OrganizationInviteEmailProps {
  organizationName: string;
  inviteLink: string;
}

const OrganizationInviteEmail = ({
  organizationName,
  inviteLink,
}: OrganizationInviteEmailProps) => {
  const currentYear = new Date().getFullYear();

  return (
    <Html>
      <Tailwind>
        <Head />
        <Preview>You&apos;ve been invited to join an organization</Preview>
        <Body className="bg-gray-100 font-sans py-[40px]">
          <Container className="bg-white rounded-[8px] mx-auto p-[48px] max-w-[600px]">
            <Heading className="text-[24px] font-bold text-gray-800 m-0 mb-[24px]">
              You&apos;ve been invited to join an organization
            </Heading>

            <Text className="text-[16px] leading-[24px] text-gray-600 mb-[24px]">
              Hello,
            </Text>

            <Text className="text-[16px] leading-[24px] text-gray-600 mb-[24px]">
              You have been invited to join <strong>{organizationName}</strong>.
              Join the team to collaborate, share resources, and work together
              effectively.
            </Text>

            <Text className="text-[16px] leading-[24px] text-gray-600 mb-[32px]">
              Click the button below to accept the invitation and set up your
              account:
            </Text>

            <Section className="text-center mb-[32px]">
              <Button
                className="bg-blue-600 text-white font-bold py-[12px] px-[24px] rounded-[4px] no-underline text-center box-border"
                href={inviteLink}
              >
                Accept Invitation
              </Button>
            </Section>

            <Text className="text-[16px] leading-[24px] text-gray-600 mb-[24px]">
              This invitation will expire in 2 days. If you have any questions
              or need assistance, please contact our support team.
            </Text>

            <Text className="text-[16px] leading-[24px] text-gray-600 mb-[32px]">
              We&apos;re excited to have you on board!
            </Text>

            <Text className="text-[16px] leading-[24px] text-gray-600 mb-[8px]">
              Best regards,
            </Text>

            <Hr className="border-t border-gray-300 my-[32px]" />

            <Text className="text-[12px] leading-[16px] text-gray-500 m-0">
              If you didn&apos;t request this invitation, you can safely ignore
              this email.
            </Text>

            <Text className="text-[12px] leading-[16px] text-gray-500 mt-[16px] mb-[32px]">
              This is an automated message, please do not reply to this email.
            </Text>

            <Hr className="border-t border-gray-300 my-[32px]" />

            <Text className="text-[12px] leading-[16px] text-gray-500 m-0">
              © {currentYear} Next API Frontend. All rights reserved.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default OrganizationInviteEmail;
