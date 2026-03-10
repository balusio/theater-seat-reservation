import 'dotenv/config';
import { PrismaClient, Event } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const SEED_THEATER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

async function main() {
  const theater = await prisma.theater.upsert({
    where: { id: SEED_THEATER_ID },
    update: {},
    create: {
      id: SEED_THEATER_ID,
      name: 'Grand Theater',
      address: '123 Broadway, New York, NY',
      totalCapacity: 170,
    },
  });

  const sectionsData = [
    { name: 'Orchestra', rows: 10, seatsPerRow: 10, price: 150.0 },
    { name: 'Mezzanine', rows: 5, seatsPerRow: 8, price: 100.0 },
    { name: 'Balcony', rows: 5, seatsPerRow: 6, price: 60.0 },
  ];

  const sections: Array<{ id: string; name: string; rows: number; seatsPerRow: number; price: number }> = [];
  for (const s of sectionsData) {
    const section = await prisma.section.upsert({
      where: { theaterId_name: { theaterId: theater.id, name: s.name } },
      update: {},
      create: {
        theaterId: theater.id,
        name: s.name,
        rows: s.rows,
        seatsPerRow: s.seatsPerRow,
      },
    });
    sections.push({ ...section, price: s.price });
  }

  for (const section of sections) {
    for (let r = 0; r < section.rows; r++) {
      const rowLetter = String.fromCharCode(65 + r);
      for (let n = 1; n <= section.seatsPerRow; n++) {
        await prisma.seat.upsert({
          where: {
            sectionId_row_number: {
              sectionId: section.id,
              row: rowLetter,
              number: n,
            },
          },
          update: {},
          create: {
            sectionId: section.id,
            row: rowLetter,
            number: n,
            label: `${rowLetter}-${n}`,
          },
        });
      }
    }
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(20, 0, 0, 0);

  const inThreeDays = new Date();
  inThreeDays.setDate(inThreeDays.getDate() + 3);
  inThreeDays.setHours(19, 30, 0, 0);

  const eventsData = [
    { id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', title: 'Hamlet', startsAt: tomorrow },
    { id: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f', title: 'Swan Lake', startsAt: inThreeDays },
  ];

  const events: Event[] = [];
  for (const e of eventsData) {
    const event = await prisma.event.upsert({
      where: { id: e.id },
      update: {},
      create: {
        id: e.id,
        theaterId: theater.id,
        title: e.title,
        startsAt: e.startsAt,
        status: 'OPEN',
      },
    });
    events.push(event);
  }

  const allSeats = await prisma.seat.findMany({
    include: { section: true },
  });

  for (const event of events) {
    for (const seat of allSeats) {
      const section = sections.find((s) => s.id === seat.sectionId);
      const price = section?.price ?? 100.0;

      await prisma.eventSeat.upsert({
        where: {
          eventId_seatId: {
            eventId: event.id,
            seatId: seat.id,
          },
        },
        update: {},
        create: {
          eventId: event.id,
          seatId: seat.id,
          status: 'AVAILABLE',
          price,
        },
      });
    }
  }

  const seatCount = await prisma.seat.count();
  const eventSeatCount = await prisma.eventSeat.count();
  console.log(`Seeded: ${seatCount} seats, ${eventSeatCount} event seats`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
