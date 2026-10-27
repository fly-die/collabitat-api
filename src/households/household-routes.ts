import type { FastifyInstance } from "fastify";
import { HttpStatus } from "../http-status.js";
import { MAX_NAME_LENGTH, addMember, createHousehold, removeMember } from "./household.js";
import { HouseholdError, HouseholdErrorCode } from "./household-errors.js";
import type { HouseholdRepository } from "./household-repository.js";

const STATUS_BY_ERROR_CODE: Record<HouseholdErrorCode, number> = {
  [HouseholdErrorCode.InvalidName]: HttpStatus.BadRequest,
  [HouseholdErrorCode.DuplicateMember]: HttpStatus.Conflict,
  [HouseholdErrorCode.MemberLimitReached]: HttpStatus.Conflict,
  [HouseholdErrorCode.MemberNotFound]: HttpStatus.NotFound,
  [HouseholdErrorCode.HouseholdNotFound]: HttpStatus.NotFound,
};

const nameBodySchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: { type: "string", maxLength: MAX_NAME_LENGTH * 2 } },
} as const;

interface NameBody {
  name: string;
}

interface HouseholdParams {
  householdId: string;
}

interface MemberParams extends HouseholdParams {
  memberId: string;
}

export function householdRoutes(repository: HouseholdRepository) {
  async function loadHousehold(householdId: string) {
    const household = await repository.findById(householdId);
    if (!household) {
      throw new HouseholdError(HouseholdErrorCode.HouseholdNotFound, "Household not found.");
    }
    return household;
  }

  return async function register(app: FastifyInstance) {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof HouseholdError) {
        return reply
          .status(STATUS_BY_ERROR_CODE[error.code])
          .send({ error: error.code, message: error.message });
      }
      return reply.send(error);
    });

    app.post<{ Body: NameBody }>(
      "/households",
      { schema: { body: nameBodySchema } },
      async (request, reply) => {
        const household = createHousehold(request.body.name);
        await repository.save(household);
        return reply.status(HttpStatus.Created).send(household);
      },
    );

    app.get<{ Params: HouseholdParams }>("/households/:householdId", async (request) =>
      loadHousehold(request.params.householdId),
    );

    app.post<{ Params: HouseholdParams; Body: NameBody }>(
      "/households/:householdId/members",
      { schema: { body: nameBodySchema } },
      async (request, reply) => {
        const household = addMember(
          await loadHousehold(request.params.householdId),
          request.body.name,
        );
        await repository.save(household);
        return reply.status(HttpStatus.Created).send(household);
      },
    );

    app.delete<{ Params: MemberParams }>(
      "/households/:householdId/members/:memberId",
      async (request) => {
        const household = removeMember(
          await loadHousehold(request.params.householdId),
          request.params.memberId,
        );
        await repository.save(household);
        return household;
      },
    );
  };
}
