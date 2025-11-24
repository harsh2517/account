// import { NextResponse } from "next/server";
// import Stripe from "stripe";
// import { adminDb } from "@/lib/firebase-admin"; 
// import nodemailer from "nodemailer";

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
//   apiVersion: "2023-10-16",
// });

// const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// // Reusable email transporter
// const transporter = nodemailer.createTransport({
//   service: "gmail",
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASSWORD,
//   },
// });

// export async function POST(req: Request) {
//   const body = await req.text();
//   const signature = req.headers.get("stripe-signature");

//   if (!signature) {
//     return NextResponse.json(
//       { error: "Missing stripe-signature header" },
//       { status: 400 }
//     );
//   }

//   let event: Stripe.Event;

//   try {
//     event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
//   } catch (err: any) {
//     return NextResponse.json(
//       { error: `Webhook verification failed: ${err.message}` },
//       { status: 400 }
//     );
//   }

//   const data = event.data;
//   const eventType = event.type;

//   try {
//     switch (eventType) {
//       case "checkout.session.completed": {
//         const session = await stripe.checkout.sessions.retrieve(
//           data.object.id,
//           { expand: ["line_items", "customer"] }
//         );

//         if (!session.customer) {
//           throw new Error("No customer associated with this session");
//         }

//         const customer = session.customer as Stripe.Customer;
//         const customerEmail = customer.email;
//         const priceId = session.line_items?.data[0]?.price?.id;

//         if (!customerEmail) {
//           throw new Error("No email found for customer");
//         }

//         // Update Firestore
//         const usersRef = adminDb.collection("users");
//         const querySnapshot = await usersRef
//           .where("email", "==", customerEmail)
//           .limit(1)
//           .get();

//         if (querySnapshot.empty) {
//           throw new Error(`No user found with email: ${customerEmail}`);
//         }

//         await querySnapshot.docs[0].ref.update({
//           hasAccess: true,
//           stripeCustomerId: customer.id,
//           priceId, 
//           lastUpdated: new Date().toISOString(),
//         });

//         // Send confirmation email
//         try {
//           await transporter.sendMail({
//             from: `"Accountooze AI" <${process.env.EMAIL_USER}>`,
//             to: customerEmail,
//             subject: "Subscription Confirmation",
//             html: `
//               <div>
//                 <h2>Thank you for your subscription! 🎉</h2>
//                 <p>Your payment was successful, and you now have full access to our service.</p>
//                 <p><strong>Subscription ID:</strong> ${session.id}</p>
//                 <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard">Access Your Dashboard</a></p>
//               </div>
//             `,
//           });
//         } catch (emailError) {
//           console.error("Failed to send confirmation email:", emailError);
//         }

//         break;
//       }

//       case "customer.subscription.deleted": {
//         const subscription = data.object as Stripe.Subscription;
//         const customerId = subscription.customer as string;

//         const usersRef = adminDb.collection("users");
//         const querySnapshot = await usersRef
//           .where("stripeCustomerId", "==", customerId)
//           .limit(1)
//           .get();

//         if (!querySnapshot.empty) {
//           await querySnapshot.docs[0].ref.update({
//             hasAccess: false,
//             lastUpdated: new Date().toISOString(),
//           });
//         }

//         break;
//       }

//       default:
//         break;
//     }
//   } catch (error: any) {
//     return NextResponse.json(
//       { error: `Webhook handler failed: ${error.message}` },
//       { status: 500 }
//     );
//   }

//   return NextResponse.json({ received: true });
// }



//v2
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminDb } from "@/lib/firebase-admin"; 
import nodemailer from "nodemailer";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

// Reusable email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Webhook verification failed: ${err.message}` },
      { status: 400 }
    );
  }

  const data = event.data;
  const eventType = event.type;

  try {
    switch (eventType) {
      case "checkout.session.completed": {
        const session = await stripe.checkout.sessions.retrieve(
          data.object.id,
          { expand: ["line_items", "customer"] } 
        );

        if (!session.customer) {
          throw new Error("No customer associated with this session");
        }

        const customer = session.customer as Stripe.Customer;
        const customerEmail = customer.email;
        const priceId = session.line_items?.data[0]?.price?.id;
        const subscriptionId = session.subscription as string | null; 

        if (!customerEmail) {
          throw new Error("No email found for customer");
        }

        let planName = "Basic Plan"; 
        let status = "active";
        let nextBillingDate = "";

        // Only try to retrieve subscription if subscriptionId exists
        if (subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            
            status = subscription.status;
            
            // Get plan name from the product
            if (subscription.items.data[0]?.price?.product) {
              const product = await stripe.products.retrieve(
                subscription.items.data[0].price.product as string
              );
              planName = product.name;
            }

            if (subscription.current_period_end) {
              nextBillingDate = new Date(subscription.current_period_end * 1000).toISOString();
            }
          } catch (subscriptionError) {
            console.error("Error retrieving subscription:", subscriptionError);
          }
        }

        // Update Firestore
        const usersRef = adminDb.collection("users");
        const querySnapshot = await usersRef
          .where("email", "==", customerEmail)
          .limit(1)
          .get();

        if (querySnapshot.empty) {
          throw new Error(`No user found with email: ${customerEmail}`);
        }

        const updateData: Record<string, any> = {
          hasAccess: true,
          stripeCustomerId: customer.id,
          priceId, 
          status,
          lastUpdated: new Date().toISOString(),
        };

        // Only add these fields if we have values for them
        if (planName) updateData.planName = planName;
        if (nextBillingDate) updateData.nextBillingDate = nextBillingDate;

        await querySnapshot.docs[0].ref.update(updateData);

        // Send confirmation email
        try {
          await transporter.sendMail({
            from: `"Accountooze AI" <${process.env.EMAIL_USER}>`,
            to: customerEmail,
            subject: "Subscription Confirmation",
            html: `
              <div>
                <h2>Thank you for your subscription! 🎉</h2>
                <p>Your payment was successful, and you now have full access to our service.</p>
                ${planName ? `<p><strong>Plan:</strong> ${planName}</p>` : ''}
                <p><strong>Status:</strong> ${status}</p>
                ${nextBillingDate ? `<p><strong>Next Billing Date:</strong> ${new Date(nextBillingDate).toLocaleDateString()}</p>` : ''}
                <p><strong>Subscription ID:</strong> ${subscriptionId || 'Pending'}</p>
                <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard">Access Your Dashboard</a></p>
              </div>
            `,
          });
        } catch (emailError) {
          console.error("Failed to send confirmation email:", emailError);
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const usersRef = adminDb.collection("users");
        const querySnapshot = await usersRef
          .where("stripeCustomerId", "==", customerId)
          .limit(1)
          .get();

        if (!querySnapshot.empty) {
          await querySnapshot.docs[0].ref.update({
            hasAccess: false,
            status: "canceled",
            lastUpdated: new Date().toISOString(),
          });
        }

        break;
      }
      default:
        break;
    }
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: `Webhook handler failed: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}