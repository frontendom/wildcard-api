import { context } from "telefunc/server";

export { getPerson };

type Person = {
  firstName: string;
  lastName: string;
  id: number;
};

const persons: Array<Person> = [
  { firstName: "John", lastName: "Smith", id: 0 },
  { firstName: "Alice", lastName: "Graham", id: 1 },
  { firstName: "Harry", lastName: "Thompson", id: 2 },
];

async function getPerson(id: number): Promise<Person | null> {
  if (!context.isLoggedIn) {
    context.isLoggedIn = true;
    return null;
  }
  return persons.find((person) => person.id === id) || null;
}
