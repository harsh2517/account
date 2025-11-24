
import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, displayName } = body;

    if (!email || !displayName) {
      return NextResponse.json({ message: 'Missing email or displayName' }, { status: 400 });
    }

    // Placeholder for sending email notification
    // In a real application, you would integrate with an email service here
    // to send a notification to contact@accountooze.com.
    // For example, using a library like Nodemailer or an SDK from SendGrid, Mailgun, Resend, etc.
    // This requires server-side setup beyond simple file modification by this AI.

    // TODO: Replace the console.log above with actual email sending logic.
    // Example (conceptual, requires setup):
    // await sendEmail({
    //   to: 'contact@accountooze.com',
    //   from: 'noreply@yourdomain.com', // Use a verified sender
    //   subject: 'New User Signup on Accountooze.ai',
    //   html: `<p>A new user has signed up:</p><ul><li>Name: ${displayName}</li><li>Email: ${email}</li></ul>`,
    // });

    return NextResponse.json({ message: 'Notification placeholder processed successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error in notify-signup API route:', error);
    let errorMessage = 'Internal server error';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    return NextResponse.json({ message: 'Error processing notification', error: errorMessage }, { status: 500 });
  }
}
