import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  const { email, companyName, inviterName } = await request.json();

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    // Email content
    const mailOptions = {
      from: `"Accountooze.AI" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `You've been invited to join ${companyName}`,
      html: `
        <div>
          <h2>Company Invitation</h2>
          <p>You've been invited by ${inviterName} to join ${companyName} on Accountooze.AI.</p>
          <p>Sign in to your account and get started with your shared company.</p>
          <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/login">Sign In Now</a></p>
        </div>
      `,
    };

    // Send email
    await transporter.sendMail(mailOptions);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending invitation email:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send invitation email' },
      { status: 500 }
    );
  }
}